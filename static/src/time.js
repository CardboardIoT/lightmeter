var moment  = require('moment');

export default {
  splitIntoParts: function (secs) {
    var duration, parts = [];

    if (secs < 60) {
      return [{ time: secs, unit: 's' }];
    } else {
      duration = moment.duration(secs, 'seconds');
      if (duration.hours()) {
        parts.push({ time: duration.hours(), unit: 'h' });
      }
      if (duration.minutes()) {
        parts.push({ time: duration.minutes(), unit: 'm' });
      }
      if (duration.seconds()) {
        parts.push({ time: duration.seconds(), unit: 's' });
      }
      return parts;
    }
  }
}
