"""Reproducible GraphHopper data preparation. Python 3.8+, standard library only."""
import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / '.local'
SOURCES = json.loads((ROOT / 'sources.json').read_text(encoding='utf-8'))
CONFIG_REVISION = 'gh11-car-foot-bike-mmap-v1'


def hash_file(path, algorithm='sha256'):
    digest = hashlib.new(algorithm)
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def graph_version(osm_hash, gtfs_hashes, config_revision=CONFIG_REVISION):
    # Include the actual configuration template, not just a manually maintained revision.
    template = configuration('OSM', [{'path': 'GTFS'}] if gtfs_hashes else [], 'GRAPH')
    return hashlib.sha256(json.dumps([SOURCES['engine']['sha256'], config_revision, template, osm_hash, gtfs_hashes]).encode()).hexdigest()[:20]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.part')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def download(url, target, expected=None, algorithm='sha256', refresh=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = target.with_suffix(target.suffix + '.json')
    if target.exists() and not refresh:
        actual = hash_file(target, algorithm)
        if not expected or actual == expected:
            print('Cached: ' + target.name, flush=True)
            old = json.loads(metadata_path.read_text(encoding='utf-8')) if metadata_path.exists() else {}
            metadata = dict(old, path=str(target), sha256=hash_file(target), bytes=target.stat().st_size, url=url)
            metadata.setdefault('downloadedAt', datetime.fromtimestamp(target.stat().st_mtime, timezone.utc).isoformat())
            write_json(metadata_path, metadata)
            return metadata
    temporary = target.with_suffix(target.suffix + '.part')
    headers = {'User-Agent': 'AccessibilityMap-local-engine/1.0'}
    offset = temporary.stat().st_size if temporary.exists() else 0
    if offset:
        headers['Range'] = 'bytes={}-'.format(offset)
    request = urllib.request.Request(url, headers=headers)
    print('Downloading: ' + url, flush=True)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            resume = offset > 0 and response.status == 206
            if resume and not response.headers.get('Content-Range', '').startswith('bytes {}-'.format(offset)):
                raise ValueError('Invalid Content-Range while resuming ' + target.name)
            total = offset if resume else 0
            checkpoint = total
            with temporary.open('ab' if resume else 'wb') as output:
                for block in iter(lambda: response.read(1024 * 1024), b''):
                    output.write(block)
                    total += len(block)
                    if total - checkpoint >= 20 * 1024 * 1024:
                        print('  {} MiB'.format(total // 1024 // 1024), flush=True)
                        checkpoint = total
            modified = response.headers.get('Last-Modified')
        if expected and hash_file(temporary, algorithm) != expected:
            temporary.unlink()
            raise ValueError('Checksum mismatch for ' + target.name + '; retry preparation (upstream may have changed).')
        if not temporary.stat().st_size:
            raise ValueError('Empty download: ' + url)
        temporary.replace(target)
        metadata = {'path': str(target), 'url': url, 'sha256': hash_file(target), 'bytes': target.stat().st_size,
                    'downloadedAt': datetime.now(timezone.utc).isoformat(), 'lastModified': modified}
        write_json(metadata_path, metadata)
        return metadata
    except Exception:
        # Retain incomplete bytes for the next run; a completed checksum failure is deleted above.
        raise


def inspect_gtfs(path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        required = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']
        for name in required:
            if name not in names:
                raise ValueError('Missing GTFS file: ' + name + ' (files must be at ZIP root)')
        if not {'calendar.txt', 'calendar_dates.txt'} & names:
            raise ValueError('Missing calendar.txt or calendar_dates.txt')
        if sum(info.file_size for info in archive.infolist()) > 2 * 1024 ** 3:
            raise ValueError('GTFS uncompressed data exceeds 2 GiB')

        def rows(name):
            if name not in names:
                return
            with archive.open(name) as raw:
                yield from csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))

        agencies = list(rows('agency.txt'))
        timezones = sorted(set(row.get('agency_timezone', '') for row in agencies))
        if not timezones or '' in timezones:
            raise ValueError('Missing agency_timezone')
        stops = {}
        for stop in rows('stops.txt'):
            try:
                lat, lon = float(stop['stop_lat']), float(stop['stop_lon'])
            except (KeyError, ValueError):
                raise ValueError('Invalid stop coordinate: ' + stop.get('stop_id', '?'))
            if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                raise ValueError('Invalid stop coordinate: ' + stop.get('stop_id', '?'))
            if stop['stop_id'] in stops:
                raise ValueError('Duplicate stop_id: ' + stop['stop_id'])
            stops[stop['stop_id']] = [lon, lat]
        routes = {row['route_id']: row for row in rows('routes.txt')}
        route_types = Counter(str(row['route_type']) for row in routes.values())
        trips = {}
        for row in rows('trips.txt'):
            if row['route_id'] not in routes:
                raise ValueError('Trip references unknown route: ' + row['route_id'])
            trips[row['trip_id']] = row
        used_services = {row['service_id'] for row in trips.values()}
        stop_times = 0
        max_hour = 0
        trip_times = {}
        def seconds(value):
            parts = value.split(':')
            if len(parts) != 3 or not all(p.isdigit() for p in parts) or int(parts[1]) > 59 or int(parts[2]) > 59:
                raise ValueError('Invalid GTFS time: ' + value)
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        for row in rows('stop_times.txt'):
            if row['trip_id'] not in trips:
                raise ValueError('Stop time references unknown trip: ' + row['trip_id'])
            if row['stop_id'] not in stops:
                raise ValueError('Stop time references unknown stop: ' + row['stop_id'])
            stop_times += 1
            for field in ['arrival_time', 'departure_time']:
                value = row.get(field, '')
                if value:
                    value_seconds = seconds(value)
                    max_hour = max(max_hour, value_seconds // 3600)
                    low, high = trip_times.get(row['trip_id'], (value_seconds, value_seconds))
                    trip_times[row['trip_id']] = (min(low, value_seconds), max(high, value_seconds))
        calendars = [row for row in rows('calendar.txt') if row['service_id'] in used_services]
        exceptions = [row for row in rows('calendar_dates.txt') if row['service_id'] in used_services]
        known_services = {r['service_id'] for r in calendars + exceptions}
        if not used_services <= known_services:
            raise ValueError('Trips reference missing service calendar')
        dates = [r[k] for r in calendars for k in ['start_date', 'end_date']]
        dates += [r['date'] for r in exceptions if r['exception_type'] == '1']
        if not stops or not trips or not stop_times or not dates:
            raise ValueError('Empty GTFS stops, trips, stop times or service dates')
        for value in dates:
            datetime.strptime(value, '%Y%m%d')
        frequencies = 0
        max_service_hour = max_hour
        for row in rows('frequencies.txt'):
            if row['trip_id'] not in trip_times:
                raise ValueError('Frequency references trip without stop times: ' + row['trip_id'])
            start, end = seconds(row['start_time']), seconds(row['end_time'])
            if end <= start or int(row['headway_secs']) <= 0:
                raise ValueError('Invalid GTFS frequency interval')
            low, high = trip_times[row['trip_id']]
            max_service_hour = max(max_service_hour, (end + high - low) // 3600)
            frequencies += 1
        coords = list(stops.values())
        return {'stops': len(stops), 'routes': len(routes), 'trips': len(trips), 'stopTimes': stop_times,
                'routeTypes': dict(sorted(route_types.items())), 'hasRail': any(t in route_types for t in ['1', '2']),
                'frequencyRows': frequencies, 'maxStopTimeHours': max_hour, 'maxServiceHours': max_service_hour, 'timezones': timezones,
                'serviceStart': min(dates), 'serviceEnd': max(dates), 'calendars': calendars, 'exceptions': exceptions,
                'stopCoordinates': coords, 'bbox': [min(c[0] for c in coords), min(c[1] for c in coords), max(c[0] for c in coords), max(c[1] for c in coords)]}


def configuration(osm_path, feeds, graph_path):
    # JSON quoted strings are valid YAML; forward slashes work on Java/Windows.
    quote = lambda path: json.dumps(str(path).replace('\\', '/'))
    gtfs = ('  gtfs.file: ' + quote(','.join(str(feed['path']) for feed in feeds)) + '\n') if feeds else ''
    return '''graphhopper:
  datareader.file: {osm}
{gtfs}  graph.location: {graph}
  graph.dataaccess.default_type: MMAP
  profiles:
    - name: car
      custom_model_files: [car.json]
      turn_costs:
        vehicle_types: [motorcar, motor_vehicle]
        u_turn_costs: 60
    - name: foot
      custom_model_files: [foot.json]
    - name: bike
      custom_model_files: [bike.json]
  profiles_ch: []
  profiles_lm: []
  graph.encoded_values: car_access,car_average_speed,road_access,foot_access,foot_average_speed,foot_priority,foot_road_access,bike_access,bike_average_speed,bike_priority,bike_road_access,bike_network,road_class,road_environment,smoothness,mtb_rating,hike_rating,country,roundabout
  import.osm.ignored_highways: construction,proposed
  prepare.min_network_size: 50
  prepare.subnetworks.threads: 1
  datareader.worker_threads: 1
  routing.max_visited_nodes: 2000000
  routing.timeout_ms: 60000
server:
  application_connectors:
    - type: http
      port: 8989
      bind_host: 127.0.0.1
  admin_connectors: []
  request_log:
    appenders: []
logging:
  level: INFO
  appenders:
    - type: console
'''.format(osm=quote(osm_path), gtfs=gtfs, graph=quote(graph_path))


def prepare(args):
    region = SOURCES['regions'][args.region]
    directory = LOCAL / args.region
    directory.mkdir(parents=True, exist_ok=True)
    runtime = SOURCES['engine']
    jar = download(runtime['url'], LOCAL / 'runtime' / 'graphhopper-web-11.0.jar', runtime['sha256'])
    md5_url = region['osmUrl'] + '.md5'
    with urllib.request.urlopen(md5_url, timeout=60) as response:
        md5 = response.read().decode().strip().split()[0]
    if len(md5) != 32 or any(c not in '0123456789abcdefABCDEF' for c in md5):
        raise ValueError('Invalid OSM checksum response')
    osm = download(region['osmUrl'], LOCAL / 'downloads' / (args.region + '.osm.pbf'), md5.lower(), 'md5', args.refresh)
    osm.update({'md5': md5, 'attribution': 'OpenStreetMap contributors / Geofabrik', 'license': 'ODbL-1.0'})
    feeds = []
    if region['defaultTransit'] and not args.no_transit:
        info = SOURCES['hongKongGtfs']
        feed = download(info['url'], LOCAL / 'downloads' / 'hong-kong-gtfs.zip', refresh=args.refresh)
        feed.update({'id': info['id'], 'attribution': info['attribution'], 'limitations': info['limitations']})
        feeds.append(feed)
    for index, filename in enumerate(args.gtfs):
        source = Path(filename).resolve(strict=True)
        checksum = hash_file(source)
        target = LOCAL / 'downloads' / ('custom-' + checksum[:20] + '.zip')
        target.parent.mkdir(parents=True, exist_ok=True)
        if source != target:
            shutil.copyfile(source, target)
        feeds.append({'id': 'custom-' + str(index), 'path': str(target), 'sha256': checksum, 'bytes': target.stat().st_size,
                      'url': None, 'downloadedAt': datetime.now(timezone.utc).isoformat(),
                      'attribution': 'User supplied GTFS; retain the original publisher and license', 'limitations': []})
    for feed in feeds:
        print('Inspecting GTFS: ' + feed['id'], flush=True)
        feed['summary'] = inspect_gtfs(feed['path'])
        print(json.dumps({k: feed['summary'][k] for k in ['stops', 'routes', 'trips', 'routeTypes', 'frequencyRows', 'serviceStart', 'serviceEnd']}), flush=True)
    version = graph_version(osm['sha256'], [f['sha256'] for f in feeds])
    graph_path = directory / ('graph-' + version)
    config_path = directory / 'config.yml'
    config_path.write_text(configuration(osm['path'], feeds, graph_path), encoding='utf-8')
    manifest = {'schemaVersion': 1, 'engine': runtime, 'jar': jar, 'region': args.region, 'label': region['label'],
                'bbox': region['bbox'], 'dataVersion': version, 'configRevision': CONFIG_REVISION,
                'preparedAt': datetime.now(timezone.utc).isoformat(), 'configPath': str(config_path), 'configSha256': hash_file(config_path),
                'graphPath': str(graph_path), 'osm': osm, 'gtfs': feeds,
                'limitations': ['静态路网不含实时拥堵', '跨境通关时间与口岸限制未完整建模', '等时圈边界为路网插值，非逐地块可达保证']}
    write_json(directory / 'manifest.json', manifest)
    print('Prepared: ' + str(directory / 'manifest.json'), flush=True)
    print('Start: node engine/start.mjs --region ' + args.region, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', choices=list(SOURCES['regions']), default='guangdong')
    parser.add_argument('--no-transit', action='store_true', help='Build roads only; do not add HK GTFS')
    parser.add_argument('--gtfs', action='append', default=[], help='Additional GTFS ZIP (repeatable)')
    parser.add_argument('--refresh', action='store_true', help='Refresh downloads; creates a new graph identity when contents change')
    try:
        prepare(parser.parse_args())
    except Exception as error:
        print('Preparation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
