var Ractive = require('ractive');

var time = require('./time');

module.exports.create = function (template, conditions) {
  return new Ractive({
    el: '#container',
    template: template || '',
    oninit: function ( options ) {
      var self = this;

      this.on('changeIso', function (evt, index) {
        var available = this.get('availableIso'),
            lastIndex = available.length - 1,
            next;
        if (index < 0) { index = lastIndex; }
        next = available[index % available.length];
        this.set('iso', next);
      });

      this.observe('availableIso', function () {
        if (this.get('iso') == null) {
          this.set('iso', this.get('availableIso')[0]);
        }
      });

      conditions.on('change', function () {
        console.log('conditions have changed')
        self.set('availableIso', conditions.availableIso());
      });
    },
    data: {
      iso: null,
      availableIso: [],
      lightLevelRaw: null
    },
    computed: {
      error: function () {
        var hasLight = this.get('lightLevelRaw') != null,
            hasIso = this.get('iso') != null;

        if (!hasLight) {
          return { msg: 'No light data is being received' };
        } else if (!hasIso) {
          return { msg: 'No lighting conditions data has been set' };
        }
      },
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
