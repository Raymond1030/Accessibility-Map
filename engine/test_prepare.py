import csv
import io
from pathlib import Path
import tempfile
import unittest
import zipfile
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from unittest.mock import patch

from prepare import inspect_gtfs, graph_version, download


class FeedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'feed.zip'
        self.tables = {
            'agency.txt': [['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], ['a', 'Test', 'https://example.org', 'Asia/Hong_Kong']],
            'stops.txt': [['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], ['s1', 'One', '22.3', '114.1'], ['s2', 'Two', '22.31', '114.11']],
            'routes.txt': [['route_id', 'agency_id', 'route_type'], ['r', 'a', '3']],
            'trips.txt': [['route_id', 'service_id', 'trip_id'], ['r', 'weekday', 't']],
            'stop_times.txt': [['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], ['t', 's1', '1', '23:55:00', '23:55:00'], ['t', 's2', '2', '24:05:00', '24:05:00']],
            'calendar.txt': [['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], ['weekday', '1', '1', '1', '1', '1', '0', '0', '20261101', '20261130']],
            'calendar_dates.txt': [['service_id', 'date', 'exception_type'], ['weekday', '20261107', '1']],
        }

    def tearDown(self):
        self.directory.cleanup()

    def write(self):
        with zipfile.ZipFile(self.path, 'w') as archive:
            for name, rows in self.tables.items():
                output = io.StringIO()
                csv.writer(output).writerows(rows)
                archive.writestr(name, output.getvalue())

    def test_bus_feed_does_not_claim_rail_and_retains_overnight_calendar(self):
        self.write()
        summary = inspect_gtfs(self.path)
        self.assertEqual(summary['routeTypes'], {'3': 1})
        self.assertFalse(summary['hasRail'])
        self.assertEqual(summary['maxStopTimeHours'], 24)
        self.assertEqual(summary['serviceStart'], '20261101')
        self.assertEqual(summary['serviceEnd'], '20261130')
        self.assertEqual(summary['stopCoordinates'][0], [114.1, 22.3])
        self.assertEqual(summary['exceptions'][0]['date'], '20261107')

    def test_missing_stop_times_is_rejected(self):
        del self.tables['stop_times.txt']
        self.write()
        with self.assertRaisesRegex(ValueError, 'stop_times.txt'):
            inspect_gtfs(self.path)

    def test_nonfinite_and_out_of_range_stop_coordinates_are_rejected(self):
        for longitude in ['nan', '181']:
            self.tables['stops.txt'][1][3] = longitude
            self.write()
            with self.assertRaisesRegex(ValueError, 'coordinate'):
                inspect_gtfs(self.path)

    def test_broken_stop_reference_is_rejected(self):
        self.tables['stop_times.txt'][1][1] = 'unknown'
        self.write()
        with self.assertRaisesRegex(ValueError, 'unknown stop'):
            inspect_gtfs(self.path)

    def test_calendar_dates_only_feed_is_accepted(self):
        del self.tables['calendar.txt']
        self.write()
        self.assertEqual(inspect_gtfs(self.path)['serviceStart'], '20261107')

    def test_frequency_end_plus_trip_duration_extends_service_day(self):
        self.tables['frequencies.txt'] = [['trip_id', 'start_time', 'end_time', 'headway_secs'], ['t', '23:00:00', '27:55:00', '600']]
        self.write()
        self.assertEqual(inspect_gtfs(self.path)['maxServiceHours'], 28)

    def test_graph_identity_changes_when_feed_or_configuration_changes(self):
        self.assertNotEqual(graph_version('osm', ['a'], 'config-a'), graph_version('osm', ['b'], 'config-a'))
        self.assertNotEqual(graph_version('osm', ['a'], 'config-a'), graph_version('osm', ['a'], 'config-b'))
        original = graph_version('osm', ['a'])
        with patch('prepare.configuration', return_value='changed profile settings'):
            self.assertNotEqual(original, graph_version('osm', ['a']))

    def test_interrupted_download_resumes_and_checks_the_complete_file(self):
        payload = b'OpenStreetMap routing data'
        target = Path(self.directory.name) / 'map.pbf'
        target.with_suffix('.pbf.part').write_bytes(payload[:5])
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('Range') != 'bytes=5-':
                    self.send_error(400)
                    return
                self.send_response(206)
                self.send_header('Content-Range', 'bytes 5-25/26')
                self.end_headers()
                self.wfile.write(payload[5:])
            def log_message(self, *args):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = download('http://127.0.0.1:{}/map'.format(server.server_port), target, hashlib.sha256(payload).hexdigest())
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(result['bytes'], len(payload))
            self.assertFalse(target.with_suffix('.pbf.part').exists())
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
