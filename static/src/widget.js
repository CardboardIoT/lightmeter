var fs = require('fs');

var ui = require('./ui'),
    conditions = require('./conditions');

var defaultTemplate = fs.readFileSync(__dirname + '/../ui.tmpl').toString();

var Widget = function (template, useDefaults) {
  var self = this;
  self.conditions = conditions.create();

  self.template = template || defaultTemplate;

  // Prepoulate with default conditions
  if (useDefaults === true) {
    conditions.defaults.forEach(function (condition) {
      self.addLightingCondition(condition);
    });
  }

  self.ui = ui.create(self.template, self.conditions);
}

Widget.prototype.setLightLevel = function (value) {
  this.ui.animate('lightLevel', parseFloat(value) );
}

Widget.prototype.addLightingCondition = function (spec) {
  this.conditions.add(spec);
}

Widget.defaults = conditions.defaults;

module.exports = Widget;
