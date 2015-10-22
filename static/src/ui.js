var Ractive = require('ractive');

var conditions = require('./conditions'),
    time = require('./time');

module.exports.create = function (template) {
  return new Ractive({
    el: '#container',
    template: template || '',
    oninit: function ( options ) {
      this.on('changeIso', function (evt, index) {
        var available = this.get('availableIso'),
            lastIndex = available.length - 1,
            next;
        if (index < 0) { index = lastIndex; }
        next = available[index % available.length];
        this.set('iso', next);
      });
    },
    data: {
      iso: 400,
      availableIso: conditions.availableIso(),
      lightLevelRaw: 0
    },
    computed: {
      isoIndex: function () {
        var iso = this.get('iso'),
            available = this.get('availableIso');
        return available.indexOf(iso);
      },
      timeSecs: function () {
        var c = this.get('conditions'),
            iso = this.get('iso');
        if (c && c.exposure[iso]) {
          return c.exposure[iso];
        } else {
          return null;
        }
      },
      exposure: function () {
        var timeSecs = this.get('timeSecs');
        return time.splitIntoParts(timeSecs);
      },
      lightLevel: function () {
        return 1024 - this.get('lightLevelRaw');
      },
      lightLevelPercent: function () {
        return Math.floor(
          (this.get('lightLevel') / 1024) * 100
        );
      },
      conditions: function () {
        return conditions.info(this.get('lightLevel'));
      }
    }
  });
}
