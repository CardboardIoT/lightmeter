var d3Scale  = require('d3-scale'),
    lodash = require('lodash');

var conditions = [
  {
    id: 'direct-sun',
    name: 'Direct sun',
    exposure: {
      400: 1.3,
      800: 1.6,
      200: 2.5,
      100: 5,
      50: 10
    }
  },
  {
    id: 'partial-cloud',
    name: 'Partial cloud',
    exposure: {
      400: 5,
      800: 2.5,
      200: 10,
      100: 20,
      50: 40
    }
  },
  {
    id: 'cloudy',
    name: 'Cloudy',
    exposure: {
      400: 10,
      800: 5,
      200: 20,
      100: 40,
      50: 90
    }
  },
  {
    id: 'indoors',
    name: 'Indoors',
    exposure: {
      400: 180,
      800: 90,
      200: 300,
      100: 600,
      50: 1200
    }
  },
  {
    id: 'evening',
    name: 'Evening',
    exposure: {
      400: 600,
      800: 300,
      200: 1200,
      100: 3000,
      50: 5400
    }
  }
];

var range = lodash.pluck(conditions, 'id').reverse();

var scale = d3Scale.quantize();

scale
  .domain([0, 1023])
  .range(range);

export default {
  info: function (lightLevel) {
    var id = scale(lightLevel);
    return lodash.find(conditions, { id: id });
  },
  availableIso: function () {
    return lodash(conditions[0].exposure)
            .keys()
            .map(lodash.parseInt)
            .sortBy()
            .value();
  }
}
