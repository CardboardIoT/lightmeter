var d3Scale  = require('d3-scale'),
    lodash = require('lodash'),
    EventEmitter = require('events').EventEmitter;

var defaults = [
  {
    name: 'Direct sun',
    exposure: {
      400: 1.3,
      800: 1.6,
      200: 2.5,
      100: 5,
      50: 10
    },
    colour: {
      start: '#f7ec86',
      stop : '#fdc753'
    },
    sensorRange: [0.8, 1]
  },
  {
    name: 'Partial cloud',
    exposure: {
      400: 5,
      800: 2.5,
      200: 10,
      100: 20,
      50: 40
    },
    colour: {
      start: '#f4e884',
      stop : '#60c084'
    },
    sensorRange: [0.6, 0.8]
  },
  {
    name: 'Cloudy',
    exposure: {
      400: 10,
      800: 5,
      200: 20,
      100: 40,
      50: 90
    },
    colour: {
      start: '#70c488',
      stop : '#20bcfc'
    },
    sensorRange: [0.4, 0.6]
  },
  {
    name: 'Indoors',
    exposure: {
      400: 180,
      800: 90,
      200: 300,
      100: 600,
      50: 1200
    },
    colour: {
      start: '#27bbf4',
      stop : '#6340bc'
    },
    sensorRange: [0.2, 0.4]
  },
  {
    name: 'Evening',
    exposure: {
      400: 600,
      800: 300,
      200: 1200,
      100: 3000,
      50: 5400
    },
    colour: {
      start: '#977bd7',
      stop : '#f75892'
    },
    sensorRange: [0, 0.2]
  }
];

var conditions = [],
    scale;

/*
  This computes a polylinear scale
  This allows light values to be mapped unevenly
  to lighting condition names.

  e.g. [0, 0.7, 1] -> ['sunny', 'dark']
       Values between 0 - 0.69999 will map to 'sunny'
       and values between 0.7 - 1 will map to 'dark'
*/
function createScale() {
  var domain, range;

  domain = lodash(conditions)
    .pluck('sensorRange')
    .flatten()
    .uniq()
    .value();

  range = lodash(conditions)
    .pluck('name')
    .value();

  return d3Scale
    .quantile()
    .domain(domain)
    .range(range);
}

module.exports.defaults = defaults;

module.exports.create = function () {
  var scale = createScale();
  var instance = new EventEmitter();

  instance.add = function (condition) {
    conditions.push(condition);
    conditions = lodash.sortBy(conditions, 'sensorRange');

    scale = createScale();
    instance.emit('change');
  };

  instance.info = function (lightLevel) {
    var name = scale(lightLevel);
    return lodash.find(conditions, { name: name });
  };

  instance.availableIso = function () {
    var available = [];

    if (conditions[0] && conditions[0].exposure) {
      available = lodash(conditions[0].exposure)
              .keys()
              .map(lodash.parseInt)
              .sortBy()
              .value();
    }

    return available;
  };
  return instance;
}
