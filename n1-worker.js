// SharedWorker entry: one simulation shared by the pilot, ground and live windows of the same browser.
importScripts('flight-dynamics.js', 'n1-engine.js', 'n1-host.js');
const host = self.GroundN1Host.createHost();
setInterval(() => host.tick(), 16);
self.onconnect = e => {
  const port = e.ports[0];
  host.addPort(port);
  port.onmessage = ev => host.handle(port, ev.data);
  port.start();
};
