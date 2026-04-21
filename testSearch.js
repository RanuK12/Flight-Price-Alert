const hybrid = require('./src/services/hybridSearch');
hybrid.search({
  origin: 'BUE',
  destination: 'MAD',
  departureDate: '2026-06-01',
  currency: 'USD',
  max: 1
}, { mode: 'background' })
.then(res => console.log('Result:', JSON.stringify(res, null, 2)))
.catch(err => console.error('Error:', err));
