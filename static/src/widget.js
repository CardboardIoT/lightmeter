var ui = require('./ui'),
    conditions = require('./conditions');

var Widget = function (template, useDefaults) {
  var self = this;
  self.conditions = conditions.create();

  // Prepoulate with default conditions
  if (useDefaults === true) {
    conditions.defaults.forEach(function (condition) {
      self.addLightingCondition(condition);
    });
  }

  self.ui = ui.create(template || '', self.conditions);
}

Widget.prototype.setLightLevel = function (value) {
  this.ui.animate('lightLevelRaw', value);
}

Widget.prototype.addLightingCondition = function (spec) {
  this.conditions.add(spec);
}

module.exports = Widget;
