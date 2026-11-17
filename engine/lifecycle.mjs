// Keep fatal supervisor errors from leaving an owned routing process behind.
// The exit hook must remain synchronous; forced OS termination is outside Node's control.
export function guardProcess({ log, shutdown, host = process, report = console.error }) {
  log.on('error', error => {
    host.exitCode = 1
    shutdown()
    report('Cannot write GraphHopper log: ' + error.message)
  })
  host.once('uncaughtExceptionMonitor', shutdown)
  host.once('exit', shutdown)
}
