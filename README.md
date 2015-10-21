# lightmeter

A simple Arduino lightmeter and web UI.

## Install

    1. Clone this repo
    2. npm install

Tested with node.js v0.12. You may have problems with v4 and native modules.

Flash your Arduino with Standard Firmata, found in the Arduino IDE: `File -> Examples -> Firmata -> StandardFirmata`.

## Circuit

### Arduino

Wire up your Arduino exactly as in [this diagram](https://github.com/rwaldron/johnny-five/blob/master/docs/photoresistor.md):

![https://github.com/rwaldron/johnny-five/raw/master/docs/breadboard/photoresistor.png](https://github.com/rwaldron/johnny-five/blob/master/docs/breadboard/photoresistor.png)<br>

Fritzing diagram: [https://github.com/rwaldron/johnny-five/blob/master/docs/breadboard/photoresistor.fzz](https://github.com/rwaldron/johnny-five/blob/master/docs/breadboard/photoresistor.fzz)

## Run

There are two parts:

1. receiver for data from the microcontroller and publishing to MQTT
2. web UI listening to the MQTT broker over WebSockets and displays a UI

Start the receiver:

    npm start

Start a static server for the web UI:

    npm run static

View the web UI at [http://localhost:3000/].
