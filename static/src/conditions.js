var d3Scale  = require('d3-scale'),
    lodash = require('lodash');

var conditions = [
  {
    id: 'direct-sun',
    name: 'Direct sun',
    exposure: {
      400: 1.3
    }
  },
  {
    id: 'partial-cloud',
    name: 'Partial cloud',
    exposure: {
      400: 5
    }
  },
  {
    id: 'cloudy',
    name: 'Cloudy',
    exposure: {
      400: 10
    }
  },
  {
    id: 'indoors',
    name: 'Indoors',
    exposure: {
      400: 180
    }
  },
  {
    id: 'evening',
    name: 'Evening',
    exposure: {
      400: 600
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
  }
}
