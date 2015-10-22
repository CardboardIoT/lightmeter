var ui = require('./ui');

var Widget = function (template) {
  this.ui = ui.create(template || '');
}

Widget.prototype.setLightLevel = function (value) {
  this.ui.animate('lightLevelRaw', value);
}

module.exports = Widget;
