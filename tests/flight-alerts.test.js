const axios = require('axios');
const {
  buildLevelUrl,
  fetchLevelDayPrices,
  getCheapestDay
} = require('../index');

jest.mock('axios');

describe('LEVEL flight alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds calendar URLs with the correct month and year', () => {
    const route = {
      origin: 'EZE',
      destination: 'BCN',
      outboundDate: '2025-09-16'
    };

    const url = buildLevelUrl(route);

    expect(url).toContain('origin=EZE');
    expect(url).toContain('destination=BCN');
    expect(url).toContain('outboundDate=2025-09-16');
    expect(url).toContain('month=09');
    expect(url).toContain('year=2025');
  });

  it('normalizes numeric and string prices with two-decimal precision', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          dayPrices: [
            { date: '2025-07-30', price: '123.456' },
            { date: '2025-07-31', price: 200 },
            { date: '2025-08-01', price: '1,234.5' },
            { date: null, price: 300 },
            { date: '2025-08-02', price: 'bad' }
          ]
        }
      }
    });

    const results = await fetchLevelDayPrices({
      origin: 'EZE',
      destination: 'BCN',
      outboundDate: '2025-07-30'
    });

    expect(results).toEqual([
      { date: '2025-07-30', price: 123.46 },
      { date: '2025-07-31', price: 200 },
      { date: '2025-08-01', price: 1234.5 }
    ]);
  });

  it('selects the cheapest available day', () => {
    const dayPrices = [
      { date: '2025-07-30', price: 300 },
      { date: '2025-07-31', price: 220 },
      { date: '2025-08-01', price: 250 }
    ];

    const cheapest = getCheapestDay(dayPrices);

    expect(cheapest).toEqual({ date: '2025-07-31', price: 220 });
  });
});
