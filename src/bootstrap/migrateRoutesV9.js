module.exports = async (db) => {
  const newRoutes = [
    { origin: 'AMS', destination: 'COR', threshold: 500, currency: 'EUR' },
    { origin: 'BCN', destination: 'COR', threshold: 500, currency: 'EUR' },
    { origin: 'AMS', destination: 'EZE', threshold: 500, currency: 'EUR' },
    { origin: 'BCN', destination: 'EZE', threshold: 500, currency: 'EUR' }
  ];

  const Route = db.models.Route;
  for (const route of newRoutes) {
    await Route.upsert(route);
  }
};