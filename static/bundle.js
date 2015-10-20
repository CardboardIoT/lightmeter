(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":3,"ieee754":4,"is-array":5}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
/**
 * Determine if an object is Buffer
 *
 * Author:   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * License:  MIT
 *
 * `npm install is-buffer`
 */

module.exports = function (obj) {
  return !!(obj != null &&
    (obj._isBuffer || // For Safari 5-7 (missing Object.prototype.constructor)
      (obj.constructor &&
      typeof obj.constructor.isBuffer === 'function' &&
      obj.constructor.isBuffer(obj))
    ))
}

},{}],9:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],10:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],11:[function(require,module,exports){
(function (global){
/*! https://mths.be/punycode v1.3.2 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * http://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.3.2',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) { // in Node.js or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else { // in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else { // in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],12:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],13:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],14:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":12,"./encode":13}],15:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":16}],16:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/



/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

},{"./_stream_readable":18,"./_stream_writable":20,"core-util-is":21,"inherits":7,"process-nextick-args":22}],17:[function(require,module,exports){
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":19,"core-util-is":21,"inherits":7}],18:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/


/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/



/*<replacement>*/
var Stream;
(function (){try{
  Stream = require('st' + 'ream');
}catch(_){}finally{
  if (!Stream)
    Stream = require('events').EventEmitter;
}}())
/*</replacement>*/

var Buffer = require('buffer').Buffer;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/



/*<replacement>*/
var debug = require('util');
if (debug && debug.debuglog) {
  debug = debug.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  var Duplex = require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function')
    this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function() {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else {
      return state.length;
    }
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (typeof n !== 'number' || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (ret !== null)
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!(Buffer.isBuffer(chunk)) &&
      typeof chunk !== 'string' &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      processNextTick(emitReadable_, stream);
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    processNextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      debug('false write response, pause',
            src._readableState.awaitDrain);
      src._readableState.awaitDrain++;
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EE.listenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined))
      return;
    else if (!state.objectMode && (!chunk || !chunk.length))
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }; }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"./_stream_duplex":16,"_process":10,"buffer":2,"core-util-is":21,"events":6,"inherits":7,"isarray":9,"process-nextick-args":22,"string_decoder/":29,"util":1}],19:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined)
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function')
      this._transform = options.transform;

    if (typeof options.flush === 'function')
      this._flush = options.flush;
  }

  this.once('prefinish', function() {
    if (typeof this._flush === 'function')
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":16,"core-util-is":21,"inherits":7}],20:[function(require,module,exports){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/



/*<replacement>*/
var Stream;
(function (){try{
  Stream = require('st' + 'ream');
}catch(_){}finally{
  if (!Stream)
    Stream = require('events').EventEmitter;
}}())
/*</replacement>*/

var Buffer = require('buffer').Buffer;

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

function WritableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

WritableState.prototype.getBuffer = function writableStateGetBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function (){try {
Object.defineProperty(WritableState.prototype, 'buffer', {
  get: require('util-deprecate')(function() {
    return this.getBuffer();
  }, '_writableState.buffer is deprecated. Use ' +
      '_writableState.getBuffer() instead.')
});
}catch(_){}}());


function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function')
      this._write = options.write;

    if (typeof options.writev === 'function')
      this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;

  if (!(Buffer.isBuffer(chunk)) &&
      typeof chunk !== 'string' &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (typeof cb !== 'function')
    cb = nop;

  if (state.ended)
    writeAfterEnd(this, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.bufferedRequest)
      clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string')
    encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64',
'ucs2', 'ucs-2','utf16le', 'utf-16le', 'raw']
.indexOf((encoding + '').toLowerCase()) > -1))
    throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync)
    processNextTick(cb, er);
  else
    cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      processNextTick(afterWrite, stream, state, finished, cb);
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var buffer = [];
    var cbs = [];
    while (entry) {
      cbs.push(entry.callback);
      buffer.push(entry);
      entry = entry.next;
    }

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    state.lastBufferedRequest = null;
    doWrite(stream, state, true, state.length, buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null)
      state.lastBufferedRequest = null;
  }
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined)
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(state) {
  return (state.ending &&
          state.length === 0 &&
          state.bufferedRequest === null &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      processNextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

},{"./_stream_duplex":16,"buffer":2,"core-util-is":21,"events":6,"inherits":7,"process-nextick-args":22,"util-deprecate":23}],21:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,{"isBuffer":require("../../../../insert-module-globals/node_modules/is-buffer/index.js")})
},{"../../../../insert-module-globals/node_modules/is-buffer/index.js":8}],22:[function(require,module,exports){
(function (process){
'use strict';
module.exports = nextTick;

function nextTick(fn) {
  var args = new Array(arguments.length - 1);
  var i = 0;
  while (i < args.length) {
    args[i++] = arguments[i];
  }
  process.nextTick(function afterTick() {
    fn.apply(null, args);
  });
}

}).call(this,require('_process'))
},{"_process":10}],23:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],24:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":17}],25:[function(require,module,exports){
var Stream = (function (){
  try {
    return require('st' + 'ream'); // hack to fix a circular dependency issue when used with browserify
  } catch(_){}
}());
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream || exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":16,"./lib/_stream_passthrough.js":17,"./lib/_stream_readable.js":18,"./lib/_stream_transform.js":19,"./lib/_stream_writable.js":20}],26:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":19}],27:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":20}],28:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":6,"inherits":7,"readable-stream/duplex.js":15,"readable-stream/passthrough.js":24,"readable-stream/readable.js":25,"readable-stream/transform.js":26,"readable-stream/writable.js":27}],29:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":2}],30:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var punycode = require('punycode');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]*$/,

    // RFC 2396: characters reserved for delimiting URLs.
    // We actually just auto-escape these.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''].concat(unwise),
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
    hostEndingChars = ['/', '?', '#'],
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[a-z0-9A-Z_-]{0,63}$/,
    hostnamePartStart = /^([a-z0-9A-Z_-]{0,63})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && isObject(url) && url instanceof Url) return url;

  var u = new Url;
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
  if (!isString(url)) {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  var rest = url;

  // trim before proceeding.
  // This is to support parse stuff like "  http://foo.com  \n"
  rest = rest.trim();

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:c path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    // find the first instance of any hostEndingChars
    var hostEnd = -1;
    for (var i = 0; i < hostEndingChars.length; i++) {
      var hec = rest.indexOf(hostEndingChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }

    // at this point, either we have an explicit point where the
    // auth portion cannot go past, or the last @ char is the decider.
    var auth, atSign;
    if (hostEnd === -1) {
      // atSign can be anywhere.
      atSign = rest.lastIndexOf('@');
    } else {
      // atSign must be in auth portion.
      // http://a@b/c@d => host:b auth:a path:/c@d
      atSign = rest.lastIndexOf('@', hostEnd);
    }

    // Now we have a portion which is definitely the auth.
    // Pull that off.
    if (atSign !== -1) {
      auth = rest.slice(0, atSign);
      rest = rest.slice(atSign + 1);
      this.auth = decodeURIComponent(auth);
    }

    // the host is the remaining to the left of the first non-host char
    hostEnd = -1;
    for (var i = 0; i < nonHostChars.length; i++) {
      var hec = rest.indexOf(nonHostChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }
    // if we still have not hit it, then the entire thing is a host.
    if (hostEnd === -1)
      hostEnd = rest.length;

    this.host = rest.slice(0, hostEnd);
    rest = rest.slice(hostEnd);

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    this.hostname = this.hostname || '';

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = this.hostname[0] === '[' &&
        this.hostname[this.hostname.length - 1] === ']';

    // validate a little.
    if (!ipv6Hostname) {
      var hostparts = this.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            this.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a puny coded representation of "domain".
      // It only converts the part of the domain name that
      // has non ASCII characters. I.e. it dosent matter if
      // you call it with a domain that already is in ASCII.
      var domainArray = this.hostname.split('.');
      var newOut = [];
      for (var i = 0; i < domainArray.length; ++i) {
        var s = domainArray[i];
        newOut.push(s.match(/[^A-Za-z0-9_-]/) ?
            'xn--' + punycode.encode(s) : s);
      }
      this.hostname = newOut.join('.');
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;
    this.href += this.host;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }


  // chop off from the tail first.
  var hash = rest.indexOf('#');
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf('?');
  if (qm !== -1) {
    this.search = rest.substr(qm);
    this.query = rest.substr(qm + 1);
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }
  if (rest) this.pathname = rest;
  if (slashedProtocol[lowerProto] &&
      this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  //to support http.request
  if (this.pathname || this.search) {
    var p = this.pathname || '';
    var s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (isString(obj)) obj = urlParse(obj);
  if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
  return obj.format();
}

Url.prototype.format = function() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }

  var protocol = this.protocol || '',
      pathname = this.pathname || '',
      hash = this.hash || '',
      host = false,
      query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ?
        this.hostname :
        '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query &&
      isObject(this.query) &&
      Object.keys(this.query).length) {
    query = querystring.stringify(this.query);
  }

  var search = this.search || (query && ('?' + query)) || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  pathname = pathname.replace(/[?#]/g, function(match) {
    return encodeURIComponent(match);
  });
  search = search.replace('#', '%23');

  return protocol + host + pathname + search + hash;
};

function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function(relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function(relative) {
  if (isString(relative)) {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  Object.keys(this).forEach(function(k) {
    result[k] = this[k];
  }, this);

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    Object.keys(relative).forEach(function(k) {
      if (k !== 'protocol')
        result[k] = relative[k];
    });

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] &&
        result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      Object.keys(relative).forEach(function(k) {
        result[k] = relative[k];
      });
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (result.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = result.pathname && result.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
    result.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (!isNullOrUndefined(relative.search)) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especialy happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (!isNull(result.pathname) || !isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (result.host || relative.host) && (last === '.' || last === '..') ||
      last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last == '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especialy happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = result.host && result.host.indexOf('@') > 0 ?
                     result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (result.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (!isNull(result.pathname) || !isNull(result.search)) {
    result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.substr(1);
    }
    host = host.substr(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

function isString(arg) {
  return typeof arg === "string";
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isNull(arg) {
  return arg === null;
}
function isNullOrUndefined(arg) {
  return  arg == null;
}

},{"punycode":11,"querystring":14}],31:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],32:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":31,"_process":10,"inherits":7}],33:[function(require,module,exports){
(function (process,global){
/*!
 * @overview es6-promise - a tiny implementation of Promises/A+.
 * @copyright Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors (Conversion to ES6 API by Jake Archibald)
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/jakearchibald/es6-promise/master/LICENSE
 * @version   3.0.2
 */

(function() {
    "use strict";
    function lib$es6$promise$utils$$objectOrFunction(x) {
      return typeof x === 'function' || (typeof x === 'object' && x !== null);
    }

    function lib$es6$promise$utils$$isFunction(x) {
      return typeof x === 'function';
    }

    function lib$es6$promise$utils$$isMaybeThenable(x) {
      return typeof x === 'object' && x !== null;
    }

    var lib$es6$promise$utils$$_isArray;
    if (!Array.isArray) {
      lib$es6$promise$utils$$_isArray = function (x) {
        return Object.prototype.toString.call(x) === '[object Array]';
      };
    } else {
      lib$es6$promise$utils$$_isArray = Array.isArray;
    }

    var lib$es6$promise$utils$$isArray = lib$es6$promise$utils$$_isArray;
    var lib$es6$promise$asap$$len = 0;
    var lib$es6$promise$asap$$toString = {}.toString;
    var lib$es6$promise$asap$$vertxNext;
    var lib$es6$promise$asap$$customSchedulerFn;

    var lib$es6$promise$asap$$asap = function asap(callback, arg) {
      lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len] = callback;
      lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len + 1] = arg;
      lib$es6$promise$asap$$len += 2;
      if (lib$es6$promise$asap$$len === 2) {
        // If len is 2, that means that we need to schedule an async flush.
        // If additional callbacks are queued before the queue is flushed, they
        // will be processed by this flush that we are scheduling.
        if (lib$es6$promise$asap$$customSchedulerFn) {
          lib$es6$promise$asap$$customSchedulerFn(lib$es6$promise$asap$$flush);
        } else {
          lib$es6$promise$asap$$scheduleFlush();
        }
      }
    }

    function lib$es6$promise$asap$$setScheduler(scheduleFn) {
      lib$es6$promise$asap$$customSchedulerFn = scheduleFn;
    }

    function lib$es6$promise$asap$$setAsap(asapFn) {
      lib$es6$promise$asap$$asap = asapFn;
    }

    var lib$es6$promise$asap$$browserWindow = (typeof window !== 'undefined') ? window : undefined;
    var lib$es6$promise$asap$$browserGlobal = lib$es6$promise$asap$$browserWindow || {};
    var lib$es6$promise$asap$$BrowserMutationObserver = lib$es6$promise$asap$$browserGlobal.MutationObserver || lib$es6$promise$asap$$browserGlobal.WebKitMutationObserver;
    var lib$es6$promise$asap$$isNode = typeof process !== 'undefined' && {}.toString.call(process) === '[object process]';

    // test for web worker but not in IE10
    var lib$es6$promise$asap$$isWorker = typeof Uint8ClampedArray !== 'undefined' &&
      typeof importScripts !== 'undefined' &&
      typeof MessageChannel !== 'undefined';

    // node
    function lib$es6$promise$asap$$useNextTick() {
      // node version 0.10.x displays a deprecation warning when nextTick is used recursively
      // see https://github.com/cujojs/when/issues/410 for details
      return function() {
        process.nextTick(lib$es6$promise$asap$$flush);
      };
    }

    // vertx
    function lib$es6$promise$asap$$useVertxTimer() {
      return function() {
        lib$es6$promise$asap$$vertxNext(lib$es6$promise$asap$$flush);
      };
    }

    function lib$es6$promise$asap$$useMutationObserver() {
      var iterations = 0;
      var observer = new lib$es6$promise$asap$$BrowserMutationObserver(lib$es6$promise$asap$$flush);
      var node = document.createTextNode('');
      observer.observe(node, { characterData: true });

      return function() {
        node.data = (iterations = ++iterations % 2);
      };
    }

    // web worker
    function lib$es6$promise$asap$$useMessageChannel() {
      var channel = new MessageChannel();
      channel.port1.onmessage = lib$es6$promise$asap$$flush;
      return function () {
        channel.port2.postMessage(0);
      };
    }

    function lib$es6$promise$asap$$useSetTimeout() {
      return function() {
        setTimeout(lib$es6$promise$asap$$flush, 1);
      };
    }

    var lib$es6$promise$asap$$queue = new Array(1000);
    function lib$es6$promise$asap$$flush() {
      for (var i = 0; i < lib$es6$promise$asap$$len; i+=2) {
        var callback = lib$es6$promise$asap$$queue[i];
        var arg = lib$es6$promise$asap$$queue[i+1];

        callback(arg);

        lib$es6$promise$asap$$queue[i] = undefined;
        lib$es6$promise$asap$$queue[i+1] = undefined;
      }

      lib$es6$promise$asap$$len = 0;
    }

    function lib$es6$promise$asap$$attemptVertx() {
      try {
        var r = require;
        var vertx = r('vertx');
        lib$es6$promise$asap$$vertxNext = vertx.runOnLoop || vertx.runOnContext;
        return lib$es6$promise$asap$$useVertxTimer();
      } catch(e) {
        return lib$es6$promise$asap$$useSetTimeout();
      }
    }

    var lib$es6$promise$asap$$scheduleFlush;
    // Decide what async method to use to triggering processing of queued callbacks:
    if (lib$es6$promise$asap$$isNode) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useNextTick();
    } else if (lib$es6$promise$asap$$BrowserMutationObserver) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useMutationObserver();
    } else if (lib$es6$promise$asap$$isWorker) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useMessageChannel();
    } else if (lib$es6$promise$asap$$browserWindow === undefined && typeof require === 'function') {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$attemptVertx();
    } else {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useSetTimeout();
    }

    function lib$es6$promise$$internal$$noop() {}

    var lib$es6$promise$$internal$$PENDING   = void 0;
    var lib$es6$promise$$internal$$FULFILLED = 1;
    var lib$es6$promise$$internal$$REJECTED  = 2;

    var lib$es6$promise$$internal$$GET_THEN_ERROR = new lib$es6$promise$$internal$$ErrorObject();

    function lib$es6$promise$$internal$$selfFulfillment() {
      return new TypeError("You cannot resolve a promise with itself");
    }

    function lib$es6$promise$$internal$$cannotReturnOwn() {
      return new TypeError('A promises callback cannot return that same promise.');
    }

    function lib$es6$promise$$internal$$getThen(promise) {
      try {
        return promise.then;
      } catch(error) {
        lib$es6$promise$$internal$$GET_THEN_ERROR.error = error;
        return lib$es6$promise$$internal$$GET_THEN_ERROR;
      }
    }

    function lib$es6$promise$$internal$$tryThen(then, value, fulfillmentHandler, rejectionHandler) {
      try {
        then.call(value, fulfillmentHandler, rejectionHandler);
      } catch(e) {
        return e;
      }
    }

    function lib$es6$promise$$internal$$handleForeignThenable(promise, thenable, then) {
       lib$es6$promise$asap$$asap(function(promise) {
        var sealed = false;
        var error = lib$es6$promise$$internal$$tryThen(then, thenable, function(value) {
          if (sealed) { return; }
          sealed = true;
          if (thenable !== value) {
            lib$es6$promise$$internal$$resolve(promise, value);
          } else {
            lib$es6$promise$$internal$$fulfill(promise, value);
          }
        }, function(reason) {
          if (sealed) { return; }
          sealed = true;

          lib$es6$promise$$internal$$reject(promise, reason);
        }, 'Settle: ' + (promise._label || ' unknown promise'));

        if (!sealed && error) {
          sealed = true;
          lib$es6$promise$$internal$$reject(promise, error);
        }
      }, promise);
    }

    function lib$es6$promise$$internal$$handleOwnThenable(promise, thenable) {
      if (thenable._state === lib$es6$promise$$internal$$FULFILLED) {
        lib$es6$promise$$internal$$fulfill(promise, thenable._result);
      } else if (thenable._state === lib$es6$promise$$internal$$REJECTED) {
        lib$es6$promise$$internal$$reject(promise, thenable._result);
      } else {
        lib$es6$promise$$internal$$subscribe(thenable, undefined, function(value) {
          lib$es6$promise$$internal$$resolve(promise, value);
        }, function(reason) {
          lib$es6$promise$$internal$$reject(promise, reason);
        });
      }
    }

    function lib$es6$promise$$internal$$handleMaybeThenable(promise, maybeThenable) {
      if (maybeThenable.constructor === promise.constructor) {
        lib$es6$promise$$internal$$handleOwnThenable(promise, maybeThenable);
      } else {
        var then = lib$es6$promise$$internal$$getThen(maybeThenable);

        if (then === lib$es6$promise$$internal$$GET_THEN_ERROR) {
          lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$GET_THEN_ERROR.error);
        } else if (then === undefined) {
          lib$es6$promise$$internal$$fulfill(promise, maybeThenable);
        } else if (lib$es6$promise$utils$$isFunction(then)) {
          lib$es6$promise$$internal$$handleForeignThenable(promise, maybeThenable, then);
        } else {
          lib$es6$promise$$internal$$fulfill(promise, maybeThenable);
        }
      }
    }

    function lib$es6$promise$$internal$$resolve(promise, value) {
      if (promise === value) {
        lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$selfFulfillment());
      } else if (lib$es6$promise$utils$$objectOrFunction(value)) {
        lib$es6$promise$$internal$$handleMaybeThenable(promise, value);
      } else {
        lib$es6$promise$$internal$$fulfill(promise, value);
      }
    }

    function lib$es6$promise$$internal$$publishRejection(promise) {
      if (promise._onerror) {
        promise._onerror(promise._result);
      }

      lib$es6$promise$$internal$$publish(promise);
    }

    function lib$es6$promise$$internal$$fulfill(promise, value) {
      if (promise._state !== lib$es6$promise$$internal$$PENDING) { return; }

      promise._result = value;
      promise._state = lib$es6$promise$$internal$$FULFILLED;

      if (promise._subscribers.length !== 0) {
        lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish, promise);
      }
    }

    function lib$es6$promise$$internal$$reject(promise, reason) {
      if (promise._state !== lib$es6$promise$$internal$$PENDING) { return; }
      promise._state = lib$es6$promise$$internal$$REJECTED;
      promise._result = reason;

      lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publishRejection, promise);
    }

    function lib$es6$promise$$internal$$subscribe(parent, child, onFulfillment, onRejection) {
      var subscribers = parent._subscribers;
      var length = subscribers.length;

      parent._onerror = null;

      subscribers[length] = child;
      subscribers[length + lib$es6$promise$$internal$$FULFILLED] = onFulfillment;
      subscribers[length + lib$es6$promise$$internal$$REJECTED]  = onRejection;

      if (length === 0 && parent._state) {
        lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish, parent);
      }
    }

    function lib$es6$promise$$internal$$publish(promise) {
      var subscribers = promise._subscribers;
      var settled = promise._state;

      if (subscribers.length === 0) { return; }

      var child, callback, detail = promise._result;

      for (var i = 0; i < subscribers.length; i += 3) {
        child = subscribers[i];
        callback = subscribers[i + settled];

        if (child) {
          lib$es6$promise$$internal$$invokeCallback(settled, child, callback, detail);
        } else {
          callback(detail);
        }
      }

      promise._subscribers.length = 0;
    }

    function lib$es6$promise$$internal$$ErrorObject() {
      this.error = null;
    }

    var lib$es6$promise$$internal$$TRY_CATCH_ERROR = new lib$es6$promise$$internal$$ErrorObject();

    function lib$es6$promise$$internal$$tryCatch(callback, detail) {
      try {
        return callback(detail);
      } catch(e) {
        lib$es6$promise$$internal$$TRY_CATCH_ERROR.error = e;
        return lib$es6$promise$$internal$$TRY_CATCH_ERROR;
      }
    }

    function lib$es6$promise$$internal$$invokeCallback(settled, promise, callback, detail) {
      var hasCallback = lib$es6$promise$utils$$isFunction(callback),
          value, error, succeeded, failed;

      if (hasCallback) {
        value = lib$es6$promise$$internal$$tryCatch(callback, detail);

        if (value === lib$es6$promise$$internal$$TRY_CATCH_ERROR) {
          failed = true;
          error = value.error;
          value = null;
        } else {
          succeeded = true;
        }

        if (promise === value) {
          lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$cannotReturnOwn());
          return;
        }

      } else {
        value = detail;
        succeeded = true;
      }

      if (promise._state !== lib$es6$promise$$internal$$PENDING) {
        // noop
      } else if (hasCallback && succeeded) {
        lib$es6$promise$$internal$$resolve(promise, value);
      } else if (failed) {
        lib$es6$promise$$internal$$reject(promise, error);
      } else if (settled === lib$es6$promise$$internal$$FULFILLED) {
        lib$es6$promise$$internal$$fulfill(promise, value);
      } else if (settled === lib$es6$promise$$internal$$REJECTED) {
        lib$es6$promise$$internal$$reject(promise, value);
      }
    }

    function lib$es6$promise$$internal$$initializePromise(promise, resolver) {
      try {
        resolver(function resolvePromise(value){
          lib$es6$promise$$internal$$resolve(promise, value);
        }, function rejectPromise(reason) {
          lib$es6$promise$$internal$$reject(promise, reason);
        });
      } catch(e) {
        lib$es6$promise$$internal$$reject(promise, e);
      }
    }

    function lib$es6$promise$enumerator$$Enumerator(Constructor, input) {
      var enumerator = this;

      enumerator._instanceConstructor = Constructor;
      enumerator.promise = new Constructor(lib$es6$promise$$internal$$noop);

      if (enumerator._validateInput(input)) {
        enumerator._input     = input;
        enumerator.length     = input.length;
        enumerator._remaining = input.length;

        enumerator._init();

        if (enumerator.length === 0) {
          lib$es6$promise$$internal$$fulfill(enumerator.promise, enumerator._result);
        } else {
          enumerator.length = enumerator.length || 0;
          enumerator._enumerate();
          if (enumerator._remaining === 0) {
            lib$es6$promise$$internal$$fulfill(enumerator.promise, enumerator._result);
          }
        }
      } else {
        lib$es6$promise$$internal$$reject(enumerator.promise, enumerator._validationError());
      }
    }

    lib$es6$promise$enumerator$$Enumerator.prototype._validateInput = function(input) {
      return lib$es6$promise$utils$$isArray(input);
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._validationError = function() {
      return new Error('Array Methods must be provided an Array');
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._init = function() {
      this._result = new Array(this.length);
    };

    var lib$es6$promise$enumerator$$default = lib$es6$promise$enumerator$$Enumerator;

    lib$es6$promise$enumerator$$Enumerator.prototype._enumerate = function() {
      var enumerator = this;

      var length  = enumerator.length;
      var promise = enumerator.promise;
      var input   = enumerator._input;

      for (var i = 0; promise._state === lib$es6$promise$$internal$$PENDING && i < length; i++) {
        enumerator._eachEntry(input[i], i);
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._eachEntry = function(entry, i) {
      var enumerator = this;
      var c = enumerator._instanceConstructor;

      if (lib$es6$promise$utils$$isMaybeThenable(entry)) {
        if (entry.constructor === c && entry._state !== lib$es6$promise$$internal$$PENDING) {
          entry._onerror = null;
          enumerator._settledAt(entry._state, i, entry._result);
        } else {
          enumerator._willSettleAt(c.resolve(entry), i);
        }
      } else {
        enumerator._remaining--;
        enumerator._result[i] = entry;
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._settledAt = function(state, i, value) {
      var enumerator = this;
      var promise = enumerator.promise;

      if (promise._state === lib$es6$promise$$internal$$PENDING) {
        enumerator._remaining--;

        if (state === lib$es6$promise$$internal$$REJECTED) {
          lib$es6$promise$$internal$$reject(promise, value);
        } else {
          enumerator._result[i] = value;
        }
      }

      if (enumerator._remaining === 0) {
        lib$es6$promise$$internal$$fulfill(promise, enumerator._result);
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._willSettleAt = function(promise, i) {
      var enumerator = this;

      lib$es6$promise$$internal$$subscribe(promise, undefined, function(value) {
        enumerator._settledAt(lib$es6$promise$$internal$$FULFILLED, i, value);
      }, function(reason) {
        enumerator._settledAt(lib$es6$promise$$internal$$REJECTED, i, reason);
      });
    };
    function lib$es6$promise$promise$all$$all(entries) {
      return new lib$es6$promise$enumerator$$default(this, entries).promise;
    }
    var lib$es6$promise$promise$all$$default = lib$es6$promise$promise$all$$all;
    function lib$es6$promise$promise$race$$race(entries) {
      /*jshint validthis:true */
      var Constructor = this;

      var promise = new Constructor(lib$es6$promise$$internal$$noop);

      if (!lib$es6$promise$utils$$isArray(entries)) {
        lib$es6$promise$$internal$$reject(promise, new TypeError('You must pass an array to race.'));
        return promise;
      }

      var length = entries.length;

      function onFulfillment(value) {
        lib$es6$promise$$internal$$resolve(promise, value);
      }

      function onRejection(reason) {
        lib$es6$promise$$internal$$reject(promise, reason);
      }

      for (var i = 0; promise._state === lib$es6$promise$$internal$$PENDING && i < length; i++) {
        lib$es6$promise$$internal$$subscribe(Constructor.resolve(entries[i]), undefined, onFulfillment, onRejection);
      }

      return promise;
    }
    var lib$es6$promise$promise$race$$default = lib$es6$promise$promise$race$$race;
    function lib$es6$promise$promise$resolve$$resolve(object) {
      /*jshint validthis:true */
      var Constructor = this;

      if (object && typeof object === 'object' && object.constructor === Constructor) {
        return object;
      }

      var promise = new Constructor(lib$es6$promise$$internal$$noop);
      lib$es6$promise$$internal$$resolve(promise, object);
      return promise;
    }
    var lib$es6$promise$promise$resolve$$default = lib$es6$promise$promise$resolve$$resolve;
    function lib$es6$promise$promise$reject$$reject(reason) {
      /*jshint validthis:true */
      var Constructor = this;
      var promise = new Constructor(lib$es6$promise$$internal$$noop);
      lib$es6$promise$$internal$$reject(promise, reason);
      return promise;
    }
    var lib$es6$promise$promise$reject$$default = lib$es6$promise$promise$reject$$reject;

    var lib$es6$promise$promise$$counter = 0;

    function lib$es6$promise$promise$$needsResolver() {
      throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
    }

    function lib$es6$promise$promise$$needsNew() {
      throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
    }

    var lib$es6$promise$promise$$default = lib$es6$promise$promise$$Promise;
    /**
      Promise objects represent the eventual result of an asynchronous operation. The
      primary way of interacting with a promise is through its `then` method, which
      registers callbacks to receive either a promise's eventual value or the reason
      why the promise cannot be fulfilled.

      Terminology
      -----------

      - `promise` is an object or function with a `then` method whose behavior conforms to this specification.
      - `thenable` is an object or function that defines a `then` method.
      - `value` is any legal JavaScript value (including undefined, a thenable, or a promise).
      - `exception` is a value that is thrown using the throw statement.
      - `reason` is a value that indicates why a promise was rejected.
      - `settled` the final resting state of a promise, fulfilled or rejected.

      A promise can be in one of three states: pending, fulfilled, or rejected.

      Promises that are fulfilled have a fulfillment value and are in the fulfilled
      state.  Promises that are rejected have a rejection reason and are in the
      rejected state.  A fulfillment value is never a thenable.

      Promises can also be said to *resolve* a value.  If this value is also a
      promise, then the original promise's settled state will match the value's
      settled state.  So a promise that *resolves* a promise that rejects will
      itself reject, and a promise that *resolves* a promise that fulfills will
      itself fulfill.


      Basic Usage:
      ------------

      ```js
      var promise = new Promise(function(resolve, reject) {
        // on success
        resolve(value);

        // on failure
        reject(reason);
      });

      promise.then(function(value) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Advanced Usage:
      ---------------

      Promises shine when abstracting away asynchronous interactions such as
      `XMLHttpRequest`s.

      ```js
      function getJSON(url) {
        return new Promise(function(resolve, reject){
          var xhr = new XMLHttpRequest();

          xhr.open('GET', url);
          xhr.onreadystatechange = handler;
          xhr.responseType = 'json';
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.send();

          function handler() {
            if (this.readyState === this.DONE) {
              if (this.status === 200) {
                resolve(this.response);
              } else {
                reject(new Error('getJSON: `' + url + '` failed with status: [' + this.status + ']'));
              }
            }
          };
        });
      }

      getJSON('/posts.json').then(function(json) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Unlike callbacks, promises are great composable primitives.

      ```js
      Promise.all([
        getJSON('/posts'),
        getJSON('/comments')
      ]).then(function(values){
        values[0] // => postsJSON
        values[1] // => commentsJSON

        return values;
      });
      ```

      @class Promise
      @param {function} resolver
      Useful for tooling.
      @constructor
    */
    function lib$es6$promise$promise$$Promise(resolver) {
      this._id = lib$es6$promise$promise$$counter++;
      this._state = undefined;
      this._result = undefined;
      this._subscribers = [];

      if (lib$es6$promise$$internal$$noop !== resolver) {
        if (!lib$es6$promise$utils$$isFunction(resolver)) {
          lib$es6$promise$promise$$needsResolver();
        }

        if (!(this instanceof lib$es6$promise$promise$$Promise)) {
          lib$es6$promise$promise$$needsNew();
        }

        lib$es6$promise$$internal$$initializePromise(this, resolver);
      }
    }

    lib$es6$promise$promise$$Promise.all = lib$es6$promise$promise$all$$default;
    lib$es6$promise$promise$$Promise.race = lib$es6$promise$promise$race$$default;
    lib$es6$promise$promise$$Promise.resolve = lib$es6$promise$promise$resolve$$default;
    lib$es6$promise$promise$$Promise.reject = lib$es6$promise$promise$reject$$default;
    lib$es6$promise$promise$$Promise._setScheduler = lib$es6$promise$asap$$setScheduler;
    lib$es6$promise$promise$$Promise._setAsap = lib$es6$promise$asap$$setAsap;
    lib$es6$promise$promise$$Promise._asap = lib$es6$promise$asap$$asap;

    lib$es6$promise$promise$$Promise.prototype = {
      constructor: lib$es6$promise$promise$$Promise,

    /**
      The primary way of interacting with a promise is through its `then` method,
      which registers callbacks to receive either a promise's eventual value or the
      reason why the promise cannot be fulfilled.

      ```js
      findUser().then(function(user){
        // user is available
      }, function(reason){
        // user is unavailable, and you are given the reason why
      });
      ```

      Chaining
      --------

      The return value of `then` is itself a promise.  This second, 'downstream'
      promise is resolved with the return value of the first promise's fulfillment
      or rejection handler, or rejected if the handler throws an exception.

      ```js
      findUser().then(function (user) {
        return user.name;
      }, function (reason) {
        return 'default name';
      }).then(function (userName) {
        // If `findUser` fulfilled, `userName` will be the user's name, otherwise it
        // will be `'default name'`
      });

      findUser().then(function (user) {
        throw new Error('Found user, but still unhappy');
      }, function (reason) {
        throw new Error('`findUser` rejected and we're unhappy');
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // if `findUser` fulfilled, `reason` will be 'Found user, but still unhappy'.
        // If `findUser` rejected, `reason` will be '`findUser` rejected and we're unhappy'.
      });
      ```
      If the downstream promise does not specify a rejection handler, rejection reasons will be propagated further downstream.

      ```js
      findUser().then(function (user) {
        throw new PedagogicalException('Upstream error');
      }).then(function (value) {
        // never reached
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // The `PedgagocialException` is propagated all the way down to here
      });
      ```

      Assimilation
      ------------

      Sometimes the value you want to propagate to a downstream promise can only be
      retrieved asynchronously. This can be achieved by returning a promise in the
      fulfillment or rejection handler. The downstream promise will then be pending
      until the returned promise is settled. This is called *assimilation*.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // The user's comments are now available
      });
      ```

      If the assimliated promise rejects, then the downstream promise will also reject.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // If `findCommentsByAuthor` fulfills, we'll have the value here
      }, function (reason) {
        // If `findCommentsByAuthor` rejects, we'll have the reason here
      });
      ```

      Simple Example
      --------------

      Synchronous Example

      ```javascript
      var result;

      try {
        result = findResult();
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js
      findResult(function(result, err){
        if (err) {
          // failure
        } else {
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findResult().then(function(result){
        // success
      }, function(reason){
        // failure
      });
      ```

      Advanced Example
      --------------

      Synchronous Example

      ```javascript
      var author, books;

      try {
        author = findAuthor();
        books  = findBooksByAuthor(author);
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js

      function foundBooks(books) {

      }

      function failure(reason) {

      }

      findAuthor(function(author, err){
        if (err) {
          failure(err);
          // failure
        } else {
          try {
            findBoooksByAuthor(author, function(books, err) {
              if (err) {
                failure(err);
              } else {
                try {
                  foundBooks(books);
                } catch(reason) {
                  failure(reason);
                }
              }
            });
          } catch(error) {
            failure(err);
          }
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findAuthor().
        then(findBooksByAuthor).
        then(function(books){
          // found books
      }).catch(function(reason){
        // something went wrong
      });
      ```

      @method then
      @param {Function} onFulfilled
      @param {Function} onRejected
      Useful for tooling.
      @return {Promise}
    */
      then: function(onFulfillment, onRejection) {
        var parent = this;
        var state = parent._state;

        if (state === lib$es6$promise$$internal$$FULFILLED && !onFulfillment || state === lib$es6$promise$$internal$$REJECTED && !onRejection) {
          return this;
        }

        var child = new this.constructor(lib$es6$promise$$internal$$noop);
        var result = parent._result;

        if (state) {
          var callback = arguments[state - 1];
          lib$es6$promise$asap$$asap(function(){
            lib$es6$promise$$internal$$invokeCallback(state, child, callback, result);
          });
        } else {
          lib$es6$promise$$internal$$subscribe(parent, child, onFulfillment, onRejection);
        }

        return child;
      },

    /**
      `catch` is simply sugar for `then(undefined, onRejection)` which makes it the same
      as the catch block of a try/catch statement.

      ```js
      function findAuthor(){
        throw new Error('couldn't find that author');
      }

      // synchronous
      try {
        findAuthor();
      } catch(reason) {
        // something went wrong
      }

      // async with promises
      findAuthor().catch(function(reason){
        // something went wrong
      });
      ```

      @method catch
      @param {Function} onRejection
      Useful for tooling.
      @return {Promise}
    */
      'catch': function(onRejection) {
        return this.then(null, onRejection);
      }
    };
    function lib$es6$promise$polyfill$$polyfill() {
      var local;

      if (typeof global !== 'undefined') {
          local = global;
      } else if (typeof self !== 'undefined') {
          local = self;
      } else {
          try {
              local = Function('return this')();
          } catch (e) {
              throw new Error('polyfill failed because global object is unavailable in this environment');
          }
      }

      var P = local.Promise;

      if (P && Object.prototype.toString.call(P.resolve()) === '[object Promise]' && !P.cast) {
        return;
      }

      local.Promise = lib$es6$promise$promise$$default;
    }
    var lib$es6$promise$polyfill$$default = lib$es6$promise$polyfill$$polyfill;

    var lib$es6$promise$umd$$ES6Promise = {
      'Promise': lib$es6$promise$promise$$default,
      'polyfill': lib$es6$promise$polyfill$$default
    };

    /* global define:true module:true window: true */
    if (typeof define === 'function' && define['amd']) {
      define(function() { return lib$es6$promise$umd$$ES6Promise; });
    } else if (typeof module !== 'undefined' && module['exports']) {
      module['exports'] = lib$es6$promise$umd$$ES6Promise;
    } else if (typeof this !== 'undefined') {
      this['ES6Promise'] = lib$es6$promise$umd$$ES6Promise;
    }

    lib$es6$promise$polyfill$$default();
}).call(this);


}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"_process":10}],34:[function(require,module,exports){
(function (process,global){
'use strict';
/**
 * Module dependencies
 */
/*global setImmediate:true*/
var events = require('events'),
  Store = require('./store'),
  eos = require('end-of-stream'),
  mqttPacket = require('mqtt-packet'),
  Writable = require('readable-stream').Writable,
  inherits = require('inherits'),
  setImmediate = global.setImmediate || function (callback) {
    // works in node v0.8
    process.nextTick(callback);
  },
  defaultConnectOptions = {
    keepalive: 10,
    protocolId: 'MQTT',
    protocolVersion: 4,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
    clean: true
  };

function defaultId () {
  return 'mqttjs_' + Math.random().toString(16).substr(2, 8);
}

function sendPacket (client, packet, cb) {
  try {
    var buf = mqttPacket.generate(packet);
    if (!client.stream.write(buf) && cb) {
      client.stream.once('drain', cb);
    } else if (cb) {
      cb();
    }
  } catch (err) {
    if (cb) {
      cb(err);
    } else {
      client.emit('error', err);
    }
  }
}

function storeAndSend (client, packet, cb) {
  client.outgoingStore.put(packet, function storedPacket (err) {
    if (err) {
      return cb && cb(err);
    }
    sendPacket(client, packet, cb);
  });
}

function nop () {}

/**
 * MqttClient constructor
 *
 * @param {Stream} stream - stream
 * @param {Object} [options] - connection options
 * (see Connection#connect)
 */
function MqttClient (streamBuilder, options) {
  var k,
    that = this;

  if (!(this instanceof MqttClient)) {
    return new MqttClient(streamBuilder, options);
  }

  this.options = options || {};

  // Defaults
  for (k in defaultConnectOptions) {
    if ('undefined' === typeof this.options[k]) {
      this.options[k] = defaultConnectOptions[k];
    } else {
      this.options[k] = options[k];
    }
  }

  this.options.clientId = this.options.clientId || defaultId();

  this.streamBuilder = streamBuilder;

  // Inflight message storages
  this.outgoingStore = this.options.outgoingStore || new Store();
  this.incomingStore = this.options.incomingStore || new Store();

  // Ping timer, setup in _setupPingTimer
  this.pingTimer = null;
  // Is the client connected?
  this.connected = false;
  // Are we disconnecting?
  this.disconnecting = false;
  // Packet queue
  this.queue = [];
  // Are we intentionally disconnecting?
  this.disconnecting = false;
  // connack timer
  this.connackTimer = null;
  // Reconnect timer
  this.reconnectTimer = null;
  // MessageIDs starting with 1
  this.nextId = Math.floor(Math.random() * 65535);

  // Inflight callbacks
  this.outgoing = {};

  // Mark connected on connect
  this.on('connect', function () {
    this.connected = true;
    var outStore = null;
    outStore = this.outgoingStore.createStream();

    // Control of stored messages
    outStore.once('readable', function () {
      function storeDeliver () {
        var packet = outStore.read(1);
        if (!packet) {
          return;
        }
        // Avoid unnecesary stream read operations when disconnected
        if (!that.disconnecting && !that.reconnectTimer && (0 < that.options.reconnectPeriod)) {
          outStore.read(0);
          // Ensure that the next message will only be read after callback is issued
          that.outgoing[packet.messageId] = storeDeliver;
          that._sendPacket(packet);
        } else if (outStore.destroy) {
          outStore.destroy();
        }
      }
      storeDeliver();
    })
    .on('error', this.emit.bind(this, 'error'));
  });

  // Mark disconnected on stream close
  this.on('close', function () {
    this.connected = false;
  });

  // Setup ping timer
  this.on('connect', this._setupPingTimer);

  // Send queued packets
  this.on('connect', function () {
    var queue = this.queue;

    function deliver () {
      var entry = queue.shift(),
        packet = null;

      if (!entry) {
        return;
      }

      packet = entry.packet;

      that._sendPacket(
        packet,
        function (err) {
          if (entry.cb) {
            entry.cb(err);
          }
          deliver();
        }
      );
    }

    deliver();
  });


  // Clear ping timer
  this.on('close', function () {
    if (null !== that.pingTimer) {
      clearInterval(that.pingTimer);
      that.pingTimer = null;
    }
  });

  // Setup reconnect timer on disconnect
  this.on('close', this._setupReconnect);

  events.EventEmitter.call(this);

  this._setupStream();
}
inherits(MqttClient, events.EventEmitter);

/**
 * setup the event handlers in the inner stream.
 *
 * @api private
 */
MqttClient.prototype._setupStream = function () {
  var connectPacket,
    that = this,
    writable = new Writable(),
    parser = mqttPacket.parser(this.options),
    completeParse = null,
    packets = [];

  this._clearReconnect();

  this.stream = this.streamBuilder(this);

  parser.on('packet', function (packet) {
    packets.push(packet);
  });

  function process () {
    var packet = packets.shift(),
      done = completeParse;
    if (packet) {
      that._handlePacket(packet, process);
    } else {
      completeParse = null;
      done();
    }
  }

  writable._write = function (buf, enc, done) {
    completeParse = done;
    parser.parse(buf);
    process();
  };

  this.stream.pipe(writable);

  // Suppress connection errors
  this.stream.on('error', nop);

  // Echo stream close
  eos(this.stream, this.emit.bind(this, 'close'));

  // Send a connect packet
  connectPacket = Object.create(this.options);
  connectPacket.cmd = 'connect';
  // avoid message queue
  sendPacket(this, connectPacket);

  // Echo connection errors
  parser.on('error', this.emit.bind(this, 'error'));

  clearTimeout(this.connackTimer);
  this.connackTimer = setTimeout(function () {
    that._cleanUp(true);
  }, this.options.connectTimeout);
};

MqttClient.prototype._handlePacket = function (packet, done) {
  switch (packet.cmd) {
    case 'publish':
      this._handlePublish(packet, done);
      break;
    case 'puback':
    case 'pubrec':
    case 'pubcomp':
    case 'suback':
    case 'unsuback':
      this._handleAck(packet);
      done();
      break;
    case 'pubrel':
      this._handlePubrel(packet, done);
      break;
    case 'connack':
      this._handleConnack(packet);
      done();
      break;
    case 'pingresp':
      this._handlePingresp(packet);
      done();
      break;
    default:
      // do nothing
      // maybe we should do an error handling
      // or just log it
      break;
  }
};

MqttClient.prototype._checkDisconnecting = function (callback) {
  if (this.disconnecting) {
    if (callback) {
      callback(new Error('client disconnecting'));
    } else {
      this.emit(new Error('client disconnecting'));
    }
  }
  return this.disconnecting;
};

/**
 * publish - publish <message> to <topic>
 *
 * @param {String} topic - topic to publish to
 * @param {String, Buffer} message - message to publish
 * @param {Object} [opts] - publish options, includes:
 *    {Number} qos - qos level to publish on
 *    {Boolean} retain - whether or not to retain the message
 * @param {Function} [callback] - function(err){}
 *    called when publish succeeds or fails
 * @returns {MqttClient} this - for chaining
 * @api public
 *
 * @example client.publish('topic', 'message');
 * @example
 *     client.publish('topic', 'message', {qos: 1, retain: true});
 * @example client.publish('topic', 'message', console.log);
 */
MqttClient.prototype.publish = function (topic, message, opts, callback) {
  var packet;

  // .publish(topic, payload, cb);
  if ('function' === typeof opts) {
    callback = opts;
    opts = null;
  }

  // Default opts
  if (!opts) {
    opts = {qos: 0, retain: false};
  }

  if (this._checkDisconnecting(callback)) {
    return this;
  }

  packet = {
    cmd: 'publish',
    topic: topic,
    payload: message,
    qos: opts.qos,
    retain: opts.retain,
    messageId: this._nextId()
  };

  switch (opts.qos) {
    case 1:
    case 2:

      // Add to callbacks
      this.outgoing[packet.messageId] = callback || nop;
      this._sendPacket(packet);
      break;
    default:
      this._sendPacket(packet, callback);
      break;
  }

  return this;
};

/**
 * subscribe - subscribe to <topic>
 *
 * @param {String, Array, Object} topic - topic(s) to subscribe to, supports objects in the form {'topic': qos}
 * @param {Object} [opts] - optional subscription options, includes:
 *    {Number} qos - subscribe qos level
 * @param {Function} [callback] - function(err, granted){} where:
 *    {Error} err - subscription error (none at the moment!)
 *    {Array} granted - array of {topic: 't', qos: 0}
 * @returns {MqttClient} this - for chaining
 * @api public
 * @example client.subscribe('topic');
 * @example client.subscribe('topic', {qos: 1});
 * @example client.subscribe({'topic': 0, 'topic2': 1}, console.log);
 * @example client.subscribe('topic', console.log);
 */
MqttClient.prototype.subscribe = function () {
  var packet,
    args = Array.prototype.slice.call(arguments),
    subs = [],
    obj = args.shift(),
    callback = args.pop() || nop,
    opts = args.pop();

  if ('string' === typeof obj) {
    obj = [obj];
  }

  if (this._checkDisconnecting(callback)) {
    return this;
  }

  if ('function' !== typeof callback) {
    opts = callback;
    callback = nop;
  }

  if (!opts) {
    opts = { qos: 0 };
  }

  if (Array.isArray(obj)) {
    obj.forEach(function (topic) {
      subs.push({
        topic: topic,
        qos: opts.qos
      });
    });
  } else {
    Object
      .keys(obj)
      .forEach(function (k) {
        subs.push({
          topic: k,
          qos: obj[k]
        });
      });
  }

  packet = {
    cmd: 'subscribe',
    subscriptions: subs,
    qos: 1,
    retain: false,
    dup: false,
    messageId: this._nextId()
  };

  this.outgoing[packet.messageId] = callback;

  this._sendPacket(packet);

  return this;
};

/**
 * unsubscribe - unsubscribe from topic(s)
 *
 * @param {String, Array} topic - topics to unsubscribe from
 * @param {Function} [callback] - callback fired on unsuback
 * @returns {MqttClient} this - for chaining
 * @api public
 * @example client.unsubscribe('topic');
 * @example client.unsubscribe('topic', console.log);
 */
MqttClient.prototype.unsubscribe = function (topic, callback) {
  var packet = {
    cmd: 'unsubscribe',
    qos: 1,
    messageId: this._nextId()
  };

  callback = callback || nop;

  if (this._checkDisconnecting(callback)) {
    return this;
  }

  if ('string' === typeof topic) {
    packet.unsubscriptions = [topic];
  } else if ('object' === typeof topic && topic.length) {
    packet.unsubscriptions = topic;
  }

  this.outgoing[packet.messageId] = callback;

  this._sendPacket(packet);

  return this;
};

/**
 * end - close connection
 *
 * @returns {MqttClient} this - for chaining
 * @param {Boolean} force - do not wait for all in-flight messages to be acked
 * @param {Function} cb - called when the client has been closed
 *
 * @api public
 */
MqttClient.prototype.end = function (force, cb) {
  var that = this;

  if ('function' === typeof force) {
    cb = force;
    force = false;
  }

  function closeStores () {
    that.incomingStore.close(function () {
      that.outgoingStore.close(cb);
    });
  }

  function finish () {
    that._cleanUp(force, closeStores);
  }

  if (this.disconnecting) {
    return true;
  }

  this.disconnecting = true;

  if (!force && 0 < Object.keys(this.outgoing).length) {
    // wait 10ms, just to be sure we received all of it
    this.once('outgoingEmpty', setTimeout.bind(null, finish, 10));
  } else {
    finish();
  }

  return this;
};

/**
 * _reconnect - implement reconnection
 * @api privateish
 */
MqttClient.prototype._reconnect = function () {
  this.emit('reconnect');
  this._setupStream();
};

/**
 * _setupReconnect - setup reconnect timer
 */
MqttClient.prototype._setupReconnect = function () {
  var that = this;

  if (!that.disconnecting && !that.reconnectTimer && (0 < that.options.reconnectPeriod)) {
    this.emit('offline');
    that.reconnectTimer = setInterval(function () {
      that._reconnect();
    }, that.options.reconnectPeriod);
  }
};

/**
 * _clearReconnect - clear the reconnect timer
 */
MqttClient.prototype._clearReconnect = function () {
  if (this.reconnectTimer) {
    clearInterval(this.reconnectTimer);
    this.reconnectTimer = false;
  }
};


/**
 * _cleanUp - clean up on connection end
 * @api private
 */
MqttClient.prototype._cleanUp = function (forced, done) {
  if (done) {
    this.stream.on('close', done);
  }

  if (forced) {
    this.stream.destroy();
  } else {
    this._sendPacket(
      { cmd: 'disconnect' },
      setImmediate.bind(
        null,
        this.stream.end.bind(this.stream)
      )
    );
  }

  this._clearReconnect();

  if (null !== this.pingTimer) {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
};

/**
 * _sendPacket - send or queue a packet
 * @param {String} type - packet type (see `protocol`)
 * @param {Object} packet - packet options
 * @param {Function} cb - callback when the packet is sent
 * @api private
 */
MqttClient.prototype._sendPacket = function (packet, cb) {
  if (!this.connected) {
    return this.queue.push({ packet: packet, cb: cb });
  }

  switch (packet.qos) {
    case 2:
    case 1:
      storeAndSend(this, packet, cb);
      break;
    /**
     * no need of case here since it will be caught by default
     * and jshint comply that before default it must be a break
     * anyway it will result in -1 evaluation
     */
    case 0:
      /* falls through */
    default:
      sendPacket(this, packet, cb);
      break;
  }
};

/**
 * _setupPingTimer - setup the ping timer
 *
 * @api private
 */
MqttClient.prototype._setupPingTimer = function () {
  var that = this;

  if (!this.pingTimer && this.options.keepalive) {
    this.pingResp = true;
    this.pingTimer = setInterval(function () {
      that._checkPing();
    }, this.options.keepalive * 1000);
  }
};

/**
 * _checkPing - check if a pingresp has come back, and ping the server again
 *
 * @api private
 */
MqttClient.prototype._checkPing = function () {
  if (this.pingResp) {
    this.pingResp = false;
    this._sendPacket({ cmd: 'pingreq' });
  } else {
    // do a forced cleanup since socket will be in bad shape
    this._cleanUp(true);
  }
};

/**
 * _handlePingresp - handle a pingresp
 *
 * @api private
 */
MqttClient.prototype._handlePingresp = function () {
  this.pingResp = true;
};

/**
 * _handleConnack
 *
 * @param {Object} packet
 * @api private
 */

MqttClient.prototype._handleConnack = function (packet) {
  var rc = packet.returnCode,
    // TODO: move to protocol
    errors = [
      '',
      'Unacceptable protocol version',
      'Identifier rejected',
      'Server unavailable',
      'Bad username or password',
      'Not authorized'
    ];

  clearTimeout(this.connackTimer);

  if (0 === rc) {
    this.emit('connect');
  } else if (0 < rc) {
    this.emit('error',
        new Error('Connection refused: ' + errors[rc]));
  }
};

/**
 * _handlePublish
 *
 * @param {Object} packet
 * @api private
 */
/*
those late 2 case should be rewrite to comply with coding style:

case 1:
case 0:
  // do not wait sending a puback
  // no callback passed
  if (1 === qos) {
    this._sendPacket({
      cmd: 'puback',
      messageId: mid
    });
  }
  // emit the message event for both qos 1 and 0
  this.emit('message', topic, message, packet);
  this.handleMessage(packet, done);
  break;
default:
  // do nothing but every switch mus have a default
  // log or throw an error about unknown qos
  break;

for now i just suppressed the warnings
*/
MqttClient.prototype._handlePublish = function (packet, done) {
  var topic = packet.topic.toString(),
    message = packet.payload,
    qos = packet.qos,
    mid = packet.messageId,
    that = this;

  switch (qos) {
    case 2:
      this.incomingStore.put(packet, function () {
        that._sendPacket({cmd: 'pubrec', messageId: mid}, done);
      });
      break;
    case 1:
      // do not wait sending a puback
      // no callback passed
      this._sendPacket({
        cmd: 'puback',
        messageId: mid
      });
      /* falls through */
    case 0:
      // emit the message event for both qos 1 and 0
      this.emit('message', topic, message, packet);
      this.handleMessage(packet, done);
      break;
    default:
      // do nothing
      // log or throw an error about unknown qos
      break;
  }
};

/**
 * Handle messages with backpressure support, one at a time.
 * Override at will.
 *
 * @param Packet packet the packet
 * @param Function callback call when finished
 * @api public
 */
MqttClient.prototype.handleMessage = function (packet, callback) {
  callback();
};

/**
 * _handleAck
 *
 * @param {Object} packet
 * @api private
 */

MqttClient.prototype._handleAck = function (packet) {
  var mid = packet.messageId,
    type = packet.cmd,
    response = null,
    cb = this.outgoing[mid],
    that = this;

  if (!cb) {
    // Server sent an ack in error, ignore it.
    return;
  }

  // Process
  switch (type) {
    case 'pubcomp':
      // same thing as puback for QoS 2
    case 'puback':
      // Callback - we're done
      delete this.outgoing[mid];
      this.outgoingStore.del(packet, cb);
      break;
    case 'pubrec':
      response = {
        cmd: 'pubrel',
        qos: 2,
        messageId: mid
      };

      this._sendPacket(response);
      break;
    case 'suback':
      delete this.outgoing[mid];
      this.outgoingStore.del(packet, function (err, original) {
        var i,
          origSubs = original.subscriptions,
          granted = packet.granted;

        if (err) {
          // missing packet, what should we do?
          return that.emit('error', err);
        }

        for (i = 0; i < granted.length; i += 1) {
          origSubs[i].qos = granted[i];
        }

        cb(null, origSubs);
      });
      break;
    case 'unsuback':
      delete this.outgoing[mid];
      this.outgoingStore.del(packet, cb);
      break;
    default:
      that.emit('error', new Error('unrecognized packet type'));
  }

  if (this.disconnecting &&
      0 === Object.keys(this.outgoing).length) {
    this.emit('outgoingEmpty');
  }
};

/**
 * _handlePubrel
 *
 * @param {Object} packet
 * @api private
 */

MqttClient.prototype._handlePubrel = function (packet, callback) {
  var mid = packet.messageId,
    that = this;

  that.incomingStore.get(packet, function (err, pub) {
    if (err) {
      return that.emit('error', err);
    }

    if ('pubrel' !== pub.cmd) {
      that.emit('message', pub.topic, pub.payload, pub);
      that.incomingStore.put(packet);
    }

    that._sendPacket({cmd: 'pubcomp', messageId: mid}, callback);
  });
};

/**
 * _nextId
 */
MqttClient.prototype._nextId = function () {
  var id = this.nextId++;
  // Ensure 16 bit unsigned int:
  if (65535 === id) {
    this.nextId = 1;
  }
  return id;
};

module.exports = MqttClient;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./store":39,"_process":10,"end-of-stream":40,"events":6,"inherits":43,"mqtt-packet":46,"readable-stream":59}],35:[function(require,module,exports){
(function (process){
'use strict';
var MqttClient = require('../client'),
  url = require('url'),
  xtend = require('xtend'),
  protocols = {},
  protocolList = [];

if ('browser' !== process.title) {
  protocols.mqtt = require('./tcp');
  protocols.tcp = require('./tcp');
  protocols.ssl = require('./tls');
  protocols.tls = require('./tls');
  protocols.mqtts = require('./tls');
}

protocols.ws = require('./ws');
protocols.wss = require('./ws');

protocolList = [
  'mqtt',
  'mqtts',
  'ws',
  'wss'
];


/**
 * Parse the auth attribute and merge username and password in the options object.
 *
 * @param {Object} [opts] option object
 */
function parseAuthOptions (opts) {
  var matches;
  if (opts.auth) {
    matches = opts.auth.match(/^(.+):(.+)$/);
    if (matches) {
      opts.username = matches[1];
      opts.password = matches[2];
    } else {
      opts.username = opts.auth;
    }
  }
}

/**
 * connect - connect to an MQTT broker.
 *
 * @param {String} [brokerUrl] - url of the broker, optional
 * @param {Object} opts - see MqttClient#constructor
 */
function connect (brokerUrl, opts) {

  if (('object' === typeof brokerUrl) && !opts) {
    opts = brokerUrl;
    brokerUrl = null;
  }

  opts = opts || {};

  if (brokerUrl) {
    opts = xtend(url.parse(brokerUrl, true), opts);
    opts.protocol = opts.protocol.replace(/\:$/, '');
  }

  // merge in the auth options if supplied
  parseAuthOptions(opts);

  // support clientId passed in the query string of the url
  if (opts.query && 'string' === typeof opts.query.clientId) {
    opts.clientId = opts.query.clientId;
  }

  if (opts.cert && opts.key) {
    if (opts.protocol) {
      if (-1 === ['mqtts', 'wss'].indexOf(opts.protocol)) {
        /*
         * jshint and eslint
         * complains that break from default cannot be reached after throw
         * it is a foced exit from a control structure
         * maybe add a check after switch to see if it went through default
         * and then throw the error
        */
        /*jshint -W027*/
        /*eslint no-unreachable:1*/
        switch (opts.protocol) {
          case 'mqtt':
            opts.protocol = 'mqtts';
            break;
          case 'ws':
            opts.protocol = 'wss';
            break;
          default:
            throw new Error('Unknown protocol for secure conenction: "' + opts.protocol + '"!');
            break;
        }
        /*eslint no-unreachable:0*/
        /*jshint +W027*/
      }
    } else {
      // don't know what protocol he want to use, mqtts or wss
      throw new Error('Missing secure protocol key');
    }
  }

  if (!protocols[opts.protocol]) {
    opts.protocol = protocolList.filter(function (key) {
      return 'function' === typeof protocols[key];
    })[0];
  }

  if (false === opts.clean && !opts.clientId) {
    throw new Error('Missing clientId for unclean clients');
  }


  function wrapper (client) {
    if (opts.servers) {
      if (!client._reconnectCount || client._reconnectCount === opts.servers.length) {
        client._reconnectCount = 0;
      }

      opts.host = opts.servers[client._reconnectCount].host;
      opts.port = opts.servers[client._reconnectCount].port;

      client._reconnectCount++;
    }

    return protocols[opts.protocol](client, opts);
  }

  return new MqttClient(wrapper, opts);
}

module.exports = connect;
module.exports.connect = connect;

}).call(this,require('_process'))
},{"../client":34,"./tcp":36,"./tls":37,"./ws":38,"_process":10,"url":30,"xtend":79}],36:[function(require,module,exports){
'use strict';
var net = require('net');

/*
  variables port and host can be removed since
  you have all required information in opts object
*/
function buildBuilder (client, opts) {
  var port, host;
  opts.port = opts.port || 1883;
  opts.hostname = opts.hostname || opts.host || 'localhost';

  port = opts.port;
  host = opts.hostname;

  return net.createConnection(port, host);
}

module.exports = buildBuilder;

},{"net":1}],37:[function(require,module,exports){
'use strict';
var tls = require('tls');

function buildBuilder (mqttClient, opts) {
  var connection;
  opts.port = opts.port || 8883;
  opts.host = opts.hostname || opts.host || 'localhost';

  /**
   * this should be further investigated
   * the result is opts.rejectUnauthorized = opts.rejectUnauthorized
   * do you want to check for undefined and set it to false default ?
   */
  /*jshint ignore:start */
  opts.rejectUnauthorized = !(false === opts.rejectUnauthorized);
  /*jshint ignore:end */

  connection = tls.connect(opts);
  /*eslint no-use-before-define: [2, "nofunc"]*/
  connection.on('secureConnect', function () {
    if (opts.rejectUnauthorized && !connection.authorized) {
      connection.emit('error', new Error('TLS not authorized'));
    } else {
      connection.removeListener('error', handleTLSerrors);
    }
  });

  /*
   * to comply with strict rules, a function must be
   * declared before it can be used
   * so i moved it has to be  moved before its first call
   * later on maybe we can move all of them to the top of the file
   * for now i just suppressed the warning
   */
  /*jshint latedef:false*/
  function handleTLSerrors (err) {
    // How can I get verify this error is a tls error?
    if (opts.rejectUnauthorized) {
      mqttClient.emit('error', err);
    }

    // close this connection to match the behaviour of net
    // otherwise all we get is an error from the connection
    // and close event doesn't fire. This is a work around
    // to enable the reconnect code to work the same as with
    // net.createConnection
    connection.end();
  }
  /*jshint latedef:false*/

  connection.on('error', handleTLSerrors);
  return connection;
}

module.exports = buildBuilder;

},{"tls":1}],38:[function(require,module,exports){
(function (process){
'use strict';

var websocket = require('websocket-stream'),
  _URL = require('url');

function buildBuilder (client, opts) {
  var wsOpt = {
      protocol: 'mqttv3.1'
    },
    host = opts.hostname || 'localhost',
    port = String(opts.port || 80),
    path = opts.path || '/',
    url = opts.protocol + '://' + host + ':' + port + path;

  if ('wss' === opts.protocol) {
    if (opts.hasOwnProperty('rejectUnauthorized')) {
      wsOpt.rejectUnauthorized = opts.rejectUnauthorized;
    }
  }

  return websocket(url, wsOpt);
}

function buildBuilderBrowser (mqttClient, opts) {
  var url, parsed;
  if ('undefined' !== typeof (document)) { // for Web Workers! P.S: typeof(document) !== undefined may be becoming the faster one these days.
    parsed = _URL.parse(document.URL);
  } else {
    throw new Error('Could not determine host. Specify host manually.');
  }

  if (!opts.protocol) {
    if ('https:' === parsed.protocol) {
      opts.protocol = 'wss';
    } else {
      opts.protocol = 'ws';
    }
  }

  if (!opts.hostname) {
    opts.hostname = opts.host;
  }

  if (!opts.hostname) {
    opts.hostname = parsed.hostname;
    if (!opts.port) {
      opts.port = parsed.port;
    }
  }

  if (!opts.port) {
    if ('wss' === opts.protocol) {
      opts.port = 443;
    } else {
      opts.port = 80;
    }
  }

  if (!opts.path) {
    opts.path = '/';
  }

  url = opts.protocol + '://' + opts.hostname + ':' + opts.port + opts.path;

  return websocket(url, 'mqttv3.1');
}

if ('browser' !== process.title) {
  module.exports = buildBuilder;
} else {
  module.exports = buildBuilderBrowser;
}

}).call(this,require('_process'))
},{"_process":10,"url":30,"websocket-stream":78}],39:[function(require,module,exports){
(function (process){
'use strict';
var Readable = require('readable-stream').Readable,
  streamsOpts = { objectMode: true };

/**
 * In-memory implementation of the message store
 * This can actually be saved into files.
 *
 */
function Store () {
  if (!(this instanceof Store)) {
    return new Store();
  }

  this._inflights = {};
}

/**
 * Adds a packet to the store, a packet is
 * anything that has a messageId property.
 *
 */
Store.prototype.put = function (packet, cb) {
  this._inflights[packet.messageId] = packet;

  if (cb) {
    cb();
  }

  return this;
};

/**
 * Creates a stream with all the packets in the store
 *
 */
Store.prototype.createStream = function () {
  var stream = new Readable(streamsOpts),
    inflights = this._inflights,
    ids = Object.keys(this._inflights),
    destroyed = false,
    i = 0;

  stream._read = function () {
    if (!destroyed && i < ids.length) {
      this.push(inflights[ids[i++]]);
    } else {
      this.push(null);
    }
  };

  stream.destroy = function () {
    if (destroyed) {
      return;
    }

    var self = this;

    destroyed = true;

    process.nextTick(function () {
      self.emit('close');
    });
  };

  return stream;
};

/**
 * deletes a packet from the store.
 */
Store.prototype.del = function (packet, cb) {
  packet = this._inflights[packet.messageId];
  if (packet) {
    delete this._inflights[packet.messageId];
    cb(null, packet);
  } else if (cb) {
    cb(new Error('missing packet'));
  }

  return this;
};

/**
 * get a packet from the store.
 */
Store.prototype.get = function (packet, cb) {
  packet = this._inflights[packet.messageId];
  if (packet) {
    cb(null, packet);
  } else if (cb) {
    cb(new Error('missing packet'));
  }

  return this;
};

/**
 * Close the store
 */
Store.prototype.close = function (cb) {
  this._inflights = null;
  if (cb) {
    cb();
  }
};

module.exports = Store;

}).call(this,require('_process'))
},{"_process":10,"readable-stream":59}],40:[function(require,module,exports){
var once = require('once');

var noop = function() {};

var isRequest = function(stream) {
	return stream.setHeader && typeof stream.abort === 'function';
};

var isChildProcess = function(stream) {
	return stream.stdio && Array.isArray(stream.stdio) && stream.stdio.length === 3
};

var eos = function(stream, opts, callback) {
	if (typeof opts === 'function') return eos(stream, null, opts);
	if (!opts) opts = {};

	callback = once(callback || noop);

	var ws = stream._writableState;
	var rs = stream._readableState;
	var readable = opts.readable || (opts.readable !== false && stream.readable);
	var writable = opts.writable || (opts.writable !== false && stream.writable);

	var onlegacyfinish = function() {
		if (!stream.writable) onfinish();
	};

	var onfinish = function() {
		writable = false;
		if (!readable) callback();
	};

	var onend = function() {
		readable = false;
		if (!writable) callback();
	};

	var onexit = function(exitCode) {
		callback(exitCode ? new Error('exited with error code: ' + exitCode) : null);
	};

	var onclose = function() {
		if (readable && !(rs && rs.ended)) return callback(new Error('premature close'));
		if (writable && !(ws && ws.ended)) return callback(new Error('premature close'));
	};

	var onrequest = function() {
		stream.req.on('finish', onfinish);
	};

	if (isRequest(stream)) {
		stream.on('complete', onfinish);
		stream.on('abort', onclose);
		if (stream.req) onrequest();
		else stream.on('request', onrequest);
	} else if (writable && !ws) { // legacy streams
		stream.on('end', onlegacyfinish);
		stream.on('close', onlegacyfinish);
	}

	if (isChildProcess(stream)) stream.on('exit', onexit);

	stream.on('end', onend);
	stream.on('finish', onfinish);
	if (opts.error !== false) stream.on('error', callback);
	stream.on('close', onclose);

	return function() {
		stream.removeListener('complete', onfinish);
		stream.removeListener('abort', onclose);
		stream.removeListener('request', onrequest);
		if (stream.req) stream.req.removeListener('finish', onfinish);
		stream.removeListener('end', onlegacyfinish);
		stream.removeListener('close', onlegacyfinish);
		stream.removeListener('finish', onfinish);
		stream.removeListener('exit', onexit);
		stream.removeListener('end', onend);
		stream.removeListener('error', callback);
		stream.removeListener('close', onclose);
	};
};

module.exports = eos;
},{"once":42}],41:[function(require,module,exports){
// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
module.exports = wrappy
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k]
  })

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length)
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    var ret = fn.apply(this, args)
    var cb = args[args.length-1]
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k]
      })
    }
    return ret
  }
}

},{}],42:[function(require,module,exports){
var wrappy = require('wrappy')
module.exports = wrappy(once)

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  })
})

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  f.called = false
  return f
}

},{"wrappy":41}],43:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],44:[function(require,module,exports){
/* Protocol - protocol constants */

/* Command code => mnemonic */
module.exports.types = {
  0: 'reserved',
  1: 'connect',
  2: 'connack',
  3: 'publish',
  4: 'puback',
  5: 'pubrec',
  6: 'pubrel',
  7: 'pubcomp',
  8: 'subscribe',
  9: 'suback',
  10: 'unsubscribe',
  11: 'unsuback',
  12: 'pingreq',
  13: 'pingresp',
  14: 'disconnect',
  15: 'reserved'
};

/* Mnemonic => Command code */
module.exports.codes = {}
for(var k in module.exports.types) {
  var v = module.exports.types[k];
  module.exports.codes[v] = k;
}

/* Header */
module.exports.CMD_SHIFT = 4;
module.exports.CMD_MASK = 0xF0;
module.exports.DUP_MASK = 0x08;
module.exports.QOS_MASK = 0x03;
module.exports.QOS_SHIFT = 1;
module.exports.RETAIN_MASK = 0x01;

/* Length */
module.exports.LENGTH_MASK = 0x7F;
module.exports.LENGTH_FIN_MASK = 0x80;

/* Connack */
module.exports.SESSIONPRESENT_MASK = 0x01;

/* Connect */
module.exports.USERNAME_MASK = 0x80;
module.exports.PASSWORD_MASK = 0x40;
module.exports.WILL_RETAIN_MASK = 0x20;
module.exports.WILL_QOS_MASK = 0x18;
module.exports.WILL_QOS_SHIFT = 3;
module.exports.WILL_FLAG_MASK = 0x04;
module.exports.CLEAN_SESSION_MASK = 0x02;

},{}],45:[function(require,module,exports){
(function (Buffer){

'use strict';

var protocol = require('./constants')
  , empty = new Buffer(0)

function generate(packet) {

  switch (packet.cmd) {
    case 'connect':
      return connect(packet)
    case 'connack':
      return connack(packet)
    case 'publish':
      return publish(packet)
    case 'puback':
    case 'pubrec':
    case 'pubrel':
    case 'pubcomp':
    case 'unsuback':
      return confirmation(packet)
    case 'subscribe':
      return subscribe(packet)
    case 'suback':
      return suback(packet)
    case 'unsubscribe':
      return unsubscribe(packet)
    case 'pingreq':
    case 'pingresp':
    case 'disconnect':
      return emptyPacket(packet)
    default:
      throw new Error('unknown command')
  }
}

function connect(opts) {
  var opts = opts || {}
    , protocolId = opts.protocolId || 'MQTT'
    , protocolVersion = opts.protocolVersion || 4
    , will = opts.will
    , clean = opts.clean
    , keepalive = opts.keepalive || 0
    , clientId = opts.clientId || ""
    , username = opts.username
    , password = opts.password

  if (clean === undefined) {
    clean = true
  }

  var length = 0

  // Must be a string and non-falsy
  if (!protocolId ||
     (typeof protocolId !== "string" && !Buffer.isBuffer(protocolId))) {
    throw new Error('Invalid protocol id')
  } else {
    length += protocolId.length + 2
  }

  // Must be a 1 byte number
  if (!protocolVersion ||
      'number' !== typeof protocolVersion ||
      protocolVersion > 255 ||
      protocolVersion < 0) {

    throw new Error('Invalid protocol version')
  } else {
    length += 1
  }

  // ClientId might be omitted in 3.1.1, but only if cleanSession is set to 1
  if ((typeof clientId === "string" || Buffer.isBuffer(clientId)) &&
     (clientId || protocolVersion == 4) &&
     (clientId || clean)) {

    length += clientId.length + 2
  } else {

    if(protocolVersion < 4) {

      throw new Error('clientId must be supplied before 3.1.1');
    }

    if(clean == 0) {

      throw new Error('clientId must be given if cleanSession set to 0');
    }
  }

  // Must be a two byte number
  if ('number' !== typeof keepalive ||
      keepalive < 0 ||
      keepalive > 65535) {
    throw new Error('Invalid keepalive')
  } else {
    length += 2
  }

  // Connect flags
  length += 1

  // If will exists...
  if (will) {
    // It must be an object
    if ('object' !== typeof will) {
      throw new Error('Invalid will')
    }
    // It must have topic typeof string
    if (!will.topic || 'string' !== typeof will.topic) {
      throw new Error('Invalid will topic')
    } else {
      length += Buffer.byteLength(will.topic) + 2
    }

    // Payload
    if (will.payload && will.payload) {
      if (will.payload.length >= 0) {
        if ('string' === typeof will.payload) {
          length += Buffer.byteLength(will.payload) + 2
        } else {
          length += will.payload.length + 2
        }
      } else {
        throw new Error('Invalid will payload')
      }
    } else {
      length += 2
    }
  }

  // Username
  if (username) {
    if (username.length) {
      length += Buffer.byteLength(username) + 2
    } else {
      throw new Error('Invalid username')
    }
  }

  // Password
  if (password) {
    if (password.length) {
      length += byteLength(password) + 2
    } else {
      throw new Error('Invalid password')
    }
  }

  var buffer = new Buffer(1 + calcLengthLength(length) + length)
    , pos = 0

  // Generate header
  buffer.writeUInt8(protocol.codes['connect'] << protocol.CMD_SHIFT, pos++, true)

  // Generate length
  pos += writeLength(buffer, pos, length)

  // Generate protocol ID
  pos += writeStringOrBuffer(buffer, pos, protocolId)
  buffer.writeUInt8(protocolVersion, pos++, true)

  // Connect flags
  var flags = 0
  flags |= username ? protocol.USERNAME_MASK : 0
  flags |= password ? protocol.PASSWORD_MASK : 0
  flags |= (will && will.retain) ? protocol.WILL_RETAIN_MASK : 0
  flags |= (will && will.qos) ?
    will.qos << protocol.WILL_QOS_SHIFT : 0
  flags |= will ? protocol.WILL_FLAG_MASK : 0
  flags |= clean ? protocol.CLEAN_SESSION_MASK : 0

  buffer.writeUInt8(flags, pos++, true)

  // Keepalive
  pos += writeNumber(buffer, pos, keepalive)

  // Client ID
  pos += writeStringOrBuffer(buffer, pos, clientId)

  // Will
  if (will) {
  	pos += writeString(buffer, pos, will.topic)
    pos += writeStringOrBuffer(buffer, pos, will.payload)
  }

  // Username and password
  if (username)
    pos += writeStringOrBuffer(buffer, pos, username)

  if (password)
    pos += writeStringOrBuffer(buffer, pos, password)

  return buffer
}

function connack(opts) {
  var opts = opts || {}
    , rc = opts.returnCode;

  // Check return code
  if ('number' !== typeof rc)
    throw new Error('Invalid return code');

  var buffer = new Buffer(4)
    , pos = 0;

  buffer.writeUInt8(protocol.codes['connack'] << protocol.CMD_SHIFT, pos++, true);
  pos += writeLength(buffer, pos, 2);
  buffer.writeUInt8(opts.sessionPresent && protocol.SESSIONPRESENT_MASK || 0, pos++, true);
  buffer.writeUInt8(rc, pos++, true);

  return buffer;
}

function publish(opts) {
  var opts = opts || {}
    , dup = opts.dup ? protocol.DUP_MASK : 0
    , qos = opts.qos
    , retain = opts.retain ? protocol.RETAIN_MASK : 0
    , topic = opts.topic
    , payload = opts.payload || empty
    , id = opts.messageId;

  var length = 0;

  // Topic must be a non-empty string or Buffer
  if (typeof topic === "string")
    length += Buffer.byteLength(topic) + 2;
  else if (Buffer.isBuffer(topic))
    length += topic.length + 2;
  else
    throw new Error('Invalid topic');

  // get the payload length
  if (!Buffer.isBuffer(payload)) {
    length += Buffer.byteLength(payload);
  } else {
    length += payload.length;
  }

  // Message id must a number if qos > 0
  if (qos && 'number' !== typeof id) {
    throw new Error('Invalid message id')
  } else if (qos) {
    length += 2;
  }

  var buffer = new Buffer(1 + calcLengthLength(length) + length)
    , pos = 0;

  // Header
  buffer.writeUInt8(
    protocol.codes['publish'] << protocol.CMD_SHIFT |
    dup |
    qos << protocol.QOS_SHIFT |
    retain, pos++, true);

  // Remaining length
  pos += writeLength(buffer, pos, length);

  // Topic
  pos += writeStringOrBuffer(buffer, pos, topic);

  // Message ID
  if (qos > 0) {
    pos += writeNumber(buffer, pos, id);
  }

  // Payload
  if (!Buffer.isBuffer(payload)) {
    writeStringNoPos(buffer, pos, payload);
  } else {
    writeBuffer(buffer, pos, payload);
  }

  return buffer;
}

/* Puback, pubrec, pubrel and pubcomp */
function confirmation(opts) {
  var opts = opts || {}
    , type = opts.cmd || 'puback'
    , id = opts.messageId
    , dup = (opts.dup && type === 'pubrel') ? protocol.DUP_MASK : 0
    , qos = 0

  if (type === 'pubrel')
    qos = 1

  // Check message ID
  if ('number' !== typeof id)
    throw new Error('Invalid message id');

  var buffer = new Buffer(4)
    , pos = 0;

  // Header
  buffer[pos++] =
    protocol.codes[type] << protocol.CMD_SHIFT |
    dup |
    qos << protocol.QOS_SHIFT;

  // Length
  pos += writeLength(buffer, pos, 2);

  // Message ID
  pos += writeNumber(buffer, pos, id);

  return buffer;
}

function subscribe(opts) {
  var opts = opts || {}
    , dup = opts.dup ? protocol.DUP_MASK : 0
    , qos = opts.qos || 0
    , id = opts.messageId
    , subs = opts.subscriptions;

  var length = 0;

  // Check mid
  if ('number' !== typeof id) {
    throw new Error('Invalid message id');
  } else {
    length += 2;
  }
  // Check subscriptions
  if ('object' === typeof subs && subs.length) {
    for (var i = 0; i < subs.length; i += 1) {
      var topic = subs[i].topic
        , qos = subs[i].qos;

      if ('string' !== typeof topic) {
        throw new Error('Invalid subscriptions - invalid topic');
      }
      if ('number' !== typeof qos) {
        throw new Error('Invalid subscriptions - invalid qos');
      }

      length += Buffer.byteLength(topic) + 2 + 1;
    }
  } else {
    throw new Error('Invalid subscriptions');
  }

  var buffer = new Buffer(1 + calcLengthLength(length) + length)
    , pos = 0;

  // Generate header
  buffer.writeUInt8(
    protocol.codes['subscribe'] << protocol.CMD_SHIFT |
    dup |
    1 << protocol.QOS_SHIFT, pos++, true);

  // Generate length
  pos += writeLength(buffer, pos, length);

  // Generate message ID
  pos += writeNumber(buffer, pos, id);

  // Generate subs
  for (var i = 0; i < subs.length; i++) {
    var sub = subs[i]
      , topic = sub.topic
      , qos = sub.qos;

    // Write topic string
    pos += writeString(buffer, pos, topic);
    // Write qos
    buffer.writeUInt8(qos, pos++, true);
  }

  return buffer;
}

function suback(opts) {
  var opts = opts || {}
    , id = opts.messageId
    , granted = opts.granted;

  var length = 0;

  // Check message id
  if ('number' !== typeof id) {
    throw new Error('Invalid message id');
  } else {
    length += 2;
  }
  // Check granted qos vector
  if ('object' === typeof granted && granted.length) {
    for (var i = 0; i < granted.length; i += 1) {
      if ('number' !== typeof granted[i]) {
        throw new Error('Invalid qos vector');
      }
      length += 1;
    }
  } else {
    throw new Error('Invalid qos vector');
  }

  var buffer = new Buffer(1 + calcLengthLength(length) + length)
    , pos = 0;

  // Header
  buffer.writeUInt8(protocol.codes['suback'] << protocol.CMD_SHIFT, pos++, true);

  // Length
  pos += writeLength(buffer, pos, length);

  // Message ID
  pos += writeNumber(buffer, pos, id);

  // Subscriptions
  for (var i = 0; i < granted.length; i++) {
    buffer.writeUInt8(granted[i], pos++, true);
  }

  return buffer;
}

function unsubscribe(opts) {
  var opts = opts || {}
    , id = opts.messageId
    , dup = opts.dup ? protocol.DUP_MASK : 0
    , unsubs = opts.unsubscriptions;

  var length = 0;

  // Check message id
  if ('number' !== typeof id) {
    throw new Error('Invalid message id');
  } else {
    length += 2;
  }
  // Check unsubs
  if ('object' === typeof unsubs && unsubs.length) {
    for (var i = 0; i < unsubs.length; i += 1) {
      if ('string' !== typeof unsubs[i]) {
        throw new Error('Invalid unsubscriptions');
      }
      length += Buffer.byteLength(unsubs[i]) + 2;
    }
  } else {
    throw new Error('Invalid unsubscriptions');
  }

  var buffer = new Buffer(1 + calcLengthLength(length) + length)
    , pos = 0;

  // Header
  buffer[pos++] =
    protocol.codes['unsubscribe'] << protocol.CMD_SHIFT |
    dup |
    1 << protocol.QOS_SHIFT;

  // Length
  pos += writeLength(buffer, pos, length);

  // Message ID
  pos += writeNumber(buffer, pos, id);

  // Unsubs
  for (var i = 0; i < unsubs.length; i++) {
    pos += writeString(buffer, pos, unsubs[i]);
  }

  return buffer;
}

function emptyPacket(opts) {
  var buf = new Buffer(2);
  buf[0] = protocol.codes[opts.cmd] << 4;
  buf[1] = 0;
  return buf;
}

/**
 * calcLengthLength - calculate the length of the remaining
 * length field
 *
 * @api private
 */
function calcLengthLength(length) {
  if (length >= 0 && length < 128) {
    return 1
  } else if (length >= 128 && length < 16384) {
    return 2
  } else if (length >= 16384 && length < 2097152) {
    return 3
  } else if (length >= 2097152 && length < 268435456) {
    return 4
  } else {
    return 0
  }
}

/**
 * writeLength - write an MQTT style length field to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <Number> length - length (>0)
 * @returns <Number> number of bytes written
 *
 * @api private
 */

function writeLength(buffer, pos, length) {
  var digit = 0
    , origPos = pos

  do {
    digit = length % 128 | 0
    length = length / 128 | 0
    if (length > 0) {
        digit = digit | 0x80
    }
    buffer.writeUInt8(digit, pos++, true)
  } while (length > 0)

  return pos - origPos
}

/**
 * writeString - write a utf8 string to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> string - string to write
 * @return <Number> number of bytes written
 *
 * @api private
 */

function writeString(buffer, pos, string) {
  var strlen = Buffer.byteLength(string)
  writeNumber(buffer, pos, strlen)

  writeStringNoPos(buffer, pos + 2, string)

  return strlen + 2
}

function writeStringNoPos(buffer, pos, string) {
  buffer.write(string, pos)
}

/**
 * write_buffer - write buffer to buffer
 *
 * @param <Buffer> buffer - dest buffer
 * @param <Number> pos - offset
 * @param <Buffer> src - source buffer
 * @return <Number> number of bytes written
 *
 * @api private
 */

function writeBuffer(buffer, pos, src) {
  src.copy(buffer, pos)
  return src.length
}

/**
 * writeNumber - write a two byte number to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> number - number to write
 * @return <Number> number of bytes written
 *
 * @api private
 */
function writeNumber(buffer, pos, number) {
  buffer.writeUInt8(number >> 8, pos, true)
  buffer.writeUInt8(number & 0x00FF, pos + 1, true)

  return 2
}

/**
 * writeStringOrBuffer - write a String or Buffer with the its length prefix
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> toWrite - String or Buffer
 * @return <Number> number of bytes written
 */
function writeStringOrBuffer(buffer, pos, toWrite) {
  var written = 0

  if (toWrite && typeof toWrite === 'string') {
    written += writeString(buffer, pos + written, toWrite)
  } else if (toWrite) {
    written += writeNumber(buffer, pos + written, toWrite.length)
    written += writeBuffer(buffer, pos + written, toWrite)
  } else {
    written += writeNumber(buffer, pos + written, 0)
  }

  return written
}

function byteLength(bufOrString) {
  if (Buffer.isBuffer(bufOrString)) {
    return bufOrString.length
  } else {
    return Buffer.byteLength(bufOrString)
  }
}

module.exports = generate

}).call(this,require("buffer").Buffer)
},{"./constants":44,"buffer":2}],46:[function(require,module,exports){

'use strict';

exports.parser          = require('./parser')
exports.generate        = require('./generate')

},{"./generate":45,"./parser":49}],47:[function(require,module,exports){
(function (Buffer){
var DuplexStream = require('readable-stream/duplex')
  , util         = require('util')

function BufferList (callback) {
  if (!(this instanceof BufferList))
    return new BufferList(callback)

  this._bufs  = []
  this.length = 0

  if (typeof callback == 'function') {
    this._callback = callback

    var piper = function (err) {
      if (this._callback) {
        this._callback(err)
        this._callback = null
      }
    }.bind(this)

    this.on('pipe', function (src) {
      src.on('error', piper)
    })
    this.on('unpipe', function (src) {
      src.removeListener('error', piper)
    })
  }
  else if (Buffer.isBuffer(callback))
    this.append(callback)
  else if (Array.isArray(callback)) {
    callback.forEach(function (b) {
      Buffer.isBuffer(b) && this.append(b)
    }.bind(this))
  }

  DuplexStream.call(this)
}

util.inherits(BufferList, DuplexStream)

BufferList.prototype._offset = function (offset) {
  var tot = 0, i = 0, _t
  for (; i < this._bufs.length; i++) {
    _t = tot + this._bufs[i].length
    if (offset < _t)
      return [ i, offset - tot ]
    tot = _t
  }
}

BufferList.prototype.append = function (buf) {
  var isBuffer = Buffer.isBuffer(buf) ||
                 buf instanceof BufferList

  this._bufs.push(isBuffer ? buf : new Buffer(buf))
  this.length += buf.length
  return this
}

BufferList.prototype._write = function (buf, encoding, callback) {
  this.append(buf)
  if (callback)
    callback()
}

BufferList.prototype._read = function (size) {
  if (!this.length)
    return this.push(null)
  size = Math.min(size, this.length)
  this.push(this.slice(0, size))
  this.consume(size)
}

BufferList.prototype.end = function (chunk) {
  DuplexStream.prototype.end.call(this, chunk)

  if (this._callback) {
    this._callback(null, this.slice())
    this._callback = null
  }
}

BufferList.prototype.get = function (index) {
  return this.slice(index, index + 1)[0]
}

BufferList.prototype.slice = function (start, end) {
  return this.copy(null, 0, start, end)
}

BufferList.prototype.copy = function (dst, dstStart, srcStart, srcEnd) {
  if (typeof srcStart != 'number' || srcStart < 0)
    srcStart = 0
  if (typeof srcEnd != 'number' || srcEnd > this.length)
    srcEnd = this.length
  if (srcStart >= this.length)
    return dst || new Buffer(0)
  if (srcEnd <= 0)
    return dst || new Buffer(0)

  var copy   = !!dst
    , off    = this._offset(srcStart)
    , len    = srcEnd - srcStart
    , bytes  = len
    , bufoff = (copy && dstStart) || 0
    , start  = off[1]
    , l
    , i

  // copy/slice everything
  if (srcStart === 0 && srcEnd == this.length) {
    if (!copy) // slice, just return a full concat
      return Buffer.concat(this._bufs)

    // copy, need to copy individual buffers
    for (i = 0; i < this._bufs.length; i++) {
      this._bufs[i].copy(dst, bufoff)
      bufoff += this._bufs[i].length
    }

    return dst
  }

  // easy, cheap case where it's a subset of one of the buffers
  if (bytes <= this._bufs[off[0]].length - start) {
    return copy
      ? this._bufs[off[0]].copy(dst, dstStart, start, start + bytes)
      : this._bufs[off[0]].slice(start, start + bytes)
  }

  if (!copy) // a slice, we need something to copy in to
    dst = new Buffer(len)

  for (i = off[0]; i < this._bufs.length; i++) {
    l = this._bufs[i].length - start

    if (bytes > l) {
      this._bufs[i].copy(dst, bufoff, start)
    } else {
      this._bufs[i].copy(dst, bufoff, start, start + bytes)
      break
    }

    bufoff += l
    bytes -= l

    if (start)
      start = 0
  }

  return dst
}

BufferList.prototype.toString = function (encoding, start, end) {
  return this.slice(start, end).toString(encoding)
}

BufferList.prototype.consume = function (bytes) {
  while (this._bufs.length) {
    if (bytes > this._bufs[0].length) {
      bytes -= this._bufs[0].length
      this.length -= this._bufs[0].length
      this._bufs.shift()
    } else {
      this._bufs[0] = this._bufs[0].slice(bytes)
      this.length -= bytes
      break
    }
  }
  return this
}

BufferList.prototype.duplicate = function () {
  var i = 0
    , copy = new BufferList()

  for (; i < this._bufs.length; i++)
    copy.append(this._bufs[i])

  return copy
}

BufferList.prototype.destroy = function () {
  this._bufs.length = 0;
  this.length = 0;
  this.push(null);
}

;(function () {
  var methods = {
      'readDoubleBE' : 8
    , 'readDoubleLE' : 8
    , 'readFloatBE'  : 4
    , 'readFloatLE'  : 4
    , 'readInt32BE'  : 4
    , 'readInt32LE'  : 4
    , 'readUInt32BE' : 4
    , 'readUInt32LE' : 4
    , 'readInt16BE'  : 2
    , 'readInt16LE'  : 2
    , 'readUInt16BE' : 2
    , 'readUInt16LE' : 2
    , 'readInt8'     : 1
    , 'readUInt8'    : 1
  }

  for (var m in methods) {
    (function (m) {
      BufferList.prototype[m] = function (offset) {
        return this.slice(offset, offset + methods[m])[m](0)
      }
    }(m))
  }
}())

module.exports = BufferList

}).call(this,require("buffer").Buffer)
},{"buffer":2,"readable-stream/duplex":50,"util":32}],48:[function(require,module,exports){

function Packet() {
  this.cmd = null
  this.retain = false
  this.qos = 0
  this.dup = false
  this.length = -1
  this.topic = null
  this.payload = null
}

module.exports = Packet

},{}],49:[function(require,module,exports){

var bl        = require('bl')
  , inherits  = require('inherits')
  , EE        = require('events').EventEmitter
  , Packet    = require('./packet')
  , constants = require('./constants')

function Parser() {
  if (!(this instanceof Parser)) {
    return new Parser()
  }

  this._list = bl()
  this._newPacket()

  this._states = [
      '_parseHeader'
    , '_parseLength'
    , '_parsePayload'
    , '_newPacket'
  ]
  this._stateCounter = 0
}

inherits(Parser, EE)

Parser.prototype._newPacket = function () {
  if (this.packet) {
    this._list.consume(this.packet.length)
    this.emit('packet', this.packet)
  }

  this.packet = new Packet()

  return true
}

Parser.prototype.parse = function (buf) {
  this._list.append(buf)

  while ((this.packet.length != -1 || this._list.length > 0) &&
         this[this._states[this._stateCounter]]()) {
    this._stateCounter++

    if (this._stateCounter >= this._states.length) {
      this._stateCounter = 0
    }
  }

  return this._list.length
}

Parser.prototype._parseHeader = function () {

  // there is at least one byte in the buffer
  var zero = this._list.readUInt8(0)
  this.packet.cmd = constants.types[zero >> constants.CMD_SHIFT]
  this.packet.retain = (zero & constants.RETAIN_MASK) !== 0
  this.packet.qos = (zero >> constants.QOS_SHIFT) & constants.QOS_MASK
  this.packet.dup = (zero & constants.DUP_MASK) !== 0

  this._list.consume(1)

  return true
}


Parser.prototype._parseLength = function () {
  // there is at least one byte in the list
  var bytes    = 0
    , mul      = 1
    , length   = 0
    , result   = true
    , current

  while (bytes < 5) {
    current = this._list.readUInt8(bytes++)
    length += mul * (current & constants.LENGTH_MASK)
    mul *= 0x80

    if ((current & constants.LENGTH_FIN_MASK) === 0) {
      break
    }

    if (this._list.length <= bytes) {
      result = false
      break
    }
  }

  if (result) {
    this.packet.length = length
    this._list.consume(bytes)
  }

  return result
}

Parser.prototype._parsePayload = function () {
  var result = false

  // Do we have a payload? Do we have enough data to complete the payload?
  // PINGs have no payload
  if (this.packet.length === 0 || this._list.length >= this.packet.length) {

    this._pos = 0

    switch (this.packet.cmd) {
      case 'connect':
        this._parseConnect()
        break
      case 'connack':
        this._parseConnack()
        break
      case 'publish':
        this._parsePublish()
        break
      case 'puback':
      case 'pubrec':
      case 'pubrel':
      case 'pubcomp':
        this._parseMessageId()
        break
      case 'subscribe':
        this._parseSubscribe()
        break
      case 'suback':
        this._parseSuback()
        break
      case 'unsubscribe':
        this._parseUnsubscribe()
        break
      case 'unsuback':
        this._parseUnsuback()
        break
      case 'pingreq':
      case 'pingresp':
      case 'disconnect':
        // these are empty, nothing to do
        break
      default:
        this.emit('error', new Error('not supported'))
    }

    result = true
  }

  return result
}

Parser.prototype._parseConnect = function () {
  var protocolId // constants id
    , clientId // Client id
    , topic // Will topic
    , payload // Will payload
    , password // Password
    , username // Username
    , flags = {}
    , packet = this.packet

  // Parse constants id
  protocolId = this._parseString()
  if (protocolId === null)
    return this.emit('error', new Error('cannot parse protocol id'))

  packet.protocolId = protocolId

  // Parse constants version number
  if(this._pos > this._list.length)
    return this.emit('error', new Error('packet too short'))

  packet.protocolVersion = this._list.readUInt8(this._pos)
  this._pos++

  // Parse connect flags
  flags.username  = (this._list.readUInt8(this._pos) & constants.USERNAME_MASK)
  flags.password  = (this._list.readUInt8(this._pos) & constants.PASSWORD_MASK)
  flags.will      = (this._list.readUInt8(this._pos) & constants.WILL_FLAG_MASK)

  if (flags.will) {
    packet.will         = {}
    packet.will.retain  = (this._list.readUInt8(this._pos) & constants.WILL_RETAIN_MASK) !== 0
    packet.will.qos     = (this._list.readUInt8(this._pos) &
                          constants.WILL_QOS_MASK) >> constants.WILL_QOS_SHIFT
  }

  packet.clean = (this._list.readUInt8(this._pos) & constants.CLEAN_SESSION_MASK) !== 0
  this._pos++

  // Parse keepalive
  packet.keepalive = this._parseNum()
  if(packet.keepalive === -1)
    return this.emit('error', new Error('packet too short'))

  // Parse client ID
  clientId = this._parseString()
  if(clientId === null)
    return this.emit('error', new Error('packet too short'))
  packet.clientId = clientId

  if (flags.will) {
    // Parse will topic
    topic = this._parseString()
    if (topic === null)
      return this.emit('error', new Error('cannot parse will topic'))
    packet.will.topic = topic

    // Parse will payload
    payload = this._parseBuffer()
    if (payload === null)
      return this.emit('error', new Error('cannot parse will payload'))
    packet.will.payload = payload
  }

  // Parse username
  if (flags.username) {
    username = this._parseString()
    if(username === null)
      return this.emit('error', new Error('cannot parse username'))
    packet.username = username
  }

  // Parse password
  if(flags.password) {
    password = this._parseBuffer()
    if(password === null)
      return this.emit('error', new Error('cannot parse username'))
    packet.password = password
  }

  return packet
}

Parser.prototype._parseConnack = function () {
  var packet = this.packet
  packet.sessionPresent = !!(this._list.readUInt8(this._pos++) & constants.SESSIONPRESENT_MASK)
  packet.returnCode = this._list.readUInt8(this._pos)
  if(packet.returnCode === -1)
    return this.emit('error', new Error('cannot parse return code'))
}

Parser.prototype._parsePublish = function () {
  var packet = this.packet
  packet.topic = this._parseString()

  if(packet.topic === null)
    return this.emit('error', new Error('cannot parse topic'))

  // Parse message ID
  if (packet.qos > 0) {
    if (!this._parseMessageId()) { return }
  }

  packet.payload = this._list.slice(this._pos, packet.length)
}

Parser.prototype._parseSubscribe = function() {
  var packet = this.packet
    , topic
    , qos

  if (packet.qos != 1) {
    return this.emit('error', new Error('wrong subscribe header'))
  }

  packet.subscriptions = []

  if (!this._parseMessageId()) { return }

  while (this._pos < packet.length) {

    // Parse topic
    topic = this._parseString()
    if (topic === null)
      return this.emit('error', new Error('Parse error - cannot parse topic'))

    qos = this._list.readUInt8(this._pos++)

    // Push pair to subscriptions
    packet.subscriptions.push({ topic: topic, qos: qos });
  }
}

Parser.prototype._parseSuback = function() {
  this.packet.granted = []

  if (!this._parseMessageId()) { return }

  // Parse granted QoSes
  while (this._pos < this.packet.length) {
    this.packet.granted.push(this._list.readUInt8(this._pos++));
  }
}

Parser.prototype._parseUnsubscribe = function() {
  var packet = this.packet

  packet.unsubscriptions = []

  // Parse message ID
  if (!this._parseMessageId()) { return }

  while (this._pos < packet.length) {
    var topic;

    // Parse topic
    topic = this._parseString()
    if (topic === null)
      return this.emit('error', new Error('cannot parse topic'))

    // Push topic to unsubscriptions
    packet.unsubscriptions.push(topic);
  }
}

Parser.prototype._parseUnsuback = function() {
  if (!this._parseMessageId())
    return this.emit('error', new Error('cannot parse message id'))
}

Parser.prototype._parseMessageId = function() {
  var packet = this.packet

  packet.messageId = this._parseNum()

  if(packet.messageId === null) {
    this.emit('error', new Error('cannot parse message id'))
    return false
  }

  return true
}

Parser.prototype._parseString = function(maybeBuffer) {
  var length = this._parseNum()
    , result

  if(length === -1 || length + this._pos > this._list.length)
    return null

  result = this._list.toString('utf8', this._pos, this._pos + length)

  this._pos += length

  return result
}

Parser.prototype._parseBuffer = function() {
  var length = this._parseNum()
    , result

  if(length === -1 || length + this._pos > this._list.length)
    return null

  result = this._list.slice(this._pos, this._pos + length)

  this._pos += length

  return result
}

Parser.prototype._parseNum = function() {
  if(2 > this._pos + this._list.length) return -1

  var result = this._list.readUInt16BE(this._pos)
  this._pos += 2
  return result
}

module.exports = Parser

},{"./constants":44,"./packet":48,"bl":47,"events":6,"inherits":43}],50:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":51,"dup":15}],51:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))
},{"./_stream_readable":53,"./_stream_writable":55,"_process":10,"core-util-is":56,"inherits":43}],52:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":54,"core-util-is":56,"inherits":43}],53:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : 16 * 1024;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = false;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // In streams that never have any data, and do push(null) right away,
  // the consumer can miss the 'end' event if they do some I/O before
  // consuming the stream.  So, we don't emit('end') until some reading
  // happens.
  this.calledRead = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, becuase any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (typeof chunk === 'string' && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null || chunk === undefined) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      // update the buffer info.
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront) {
        state.buffer.unshift(chunk);
      } else {
        state.reading = false;
        state.buffer.push(chunk);
      }

      if (state.needReadable)
        emitReadable(stream);

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  var state = this._readableState;
  state.calledRead = true;
  var nOrig = n;
  var ret;

  if (typeof n !== 'number' || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    ret = null;

    // In cases where the decoder did not receive enough data
    // to produce a full chunk, then immediately received an
    // EOF, state.buffer will contain [<Buffer >, <Buffer 00 ...>].
    // howMuchToRead will see this and coerce the amount to
    // read to zero (because it's looking at the length of the
    // first <Buffer > in state.buffer), and we'll end up here.
    //
    // This can only happen via state.decoder -- no other venue
    // exists for pushing a zero-length chunk into state.buffer
    // and triggering this behavior. In this case, we return our
    // remaining data and end the stream, if appropriate.
    if (state.length > 0 && state.decoder) {
      ret = fromList(n, state);
      state.length -= ret.length;
    }

    if (state.length === 0)
      endReadable(this);

    return ret;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;

  // if we currently have less than the highWaterMark, then also read some
  if (state.length - n <= state.highWaterMark)
    doRead = true;

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading)
    doRead = false;

  if (doRead) {
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read called its callback synchronously, then `reading`
  // will be false, and we need to re-evaluate how much data we
  // can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we happened to read() exactly the remaining amount in the
  // buffer, and the EOF has been seen at this point, then make sure
  // that we emit 'end' on the very next tick.
  if (state.ended && !state.endEmitted && state.length === 0)
    endReadable(this);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) &&
      'string' !== typeof chunk &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // if we've ended and we have some data left, then emit
  // 'readable' now to make sure it gets picked up.
  if (state.length > 0)
    emitReadable(stream);
  else
    endReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (state.emittedReadable)
    return;

  state.emittedReadable = true;
  if (state.sync)
    process.nextTick(function() {
      emitReadable_(stream);
    });
  else
    emitReadable_(stream);
}

function emitReadable_(stream) {
  stream.emit('readable');
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    if (readable !== src) return;
    cleanup();
  }

  function onend() {
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (!dest._writableState || dest._writableState.needDrain)
      ondrain();
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    // the handler that waits for readable events after all
    // the data gets sucked out in flow.
    // This would be easier to follow with a .once() handler
    // in flow(), but that is too slow.
    this.on('readable', pipeOnReadable);

    state.flowing = true;
    process.nextTick(function() {
      flow(src);
    });
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var dest = this;
    var state = src._readableState;
    state.awaitDrain--;
    if (state.awaitDrain === 0)
      flow(src);
  };
}

function flow(src) {
  var state = src._readableState;
  var chunk;
  state.awaitDrain = 0;

  function write(dest, i, list) {
    var written = dest.write(chunk);
    if (false === written) {
      state.awaitDrain++;
    }
  }

  while (state.pipesCount && null !== (chunk = src.read())) {

    if (state.pipesCount === 1)
      write(state.pipes, 0, null);
    else
      forEach(state.pipes, write);

    src.emit('data', chunk);

    // if anyone needs a drain, then we have to wait for that.
    if (state.awaitDrain > 0)
      return;
  }

  // if every destination was unpiped, either before entering this
  // function, or in the while loop, then stop flowing.
  //
  // NB: This is a pretty rare edge case.
  if (state.pipesCount === 0) {
    state.flowing = false;

    // if there were data event listeners added, then switch to old mode.
    if (EE.listenerCount(src, 'data') > 0)
      emitDataEvents(src);
    return;
  }

  // at this point, no one needed a drain, so we just ran out of data
  // on the next readable event, start it over again.
  state.ranOut = true;
}

function pipeOnReadable() {
  if (this._readableState.ranOut) {
    this._readableState.ranOut = false;
    flow(this);
  }
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    this.removeListener('readable', pipeOnReadable);
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    this.removeListener('readable', pipeOnReadable);
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  if (ev === 'data' && !this._readableState.flowing)
    emitDataEvents(this);

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        this.read(0);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  emitDataEvents(this);
  this.read(0);
  this.emit('resume');
};

Readable.prototype.pause = function() {
  emitDataEvents(this, true);
  this.emit('pause');
};

function emitDataEvents(stream, startPaused) {
  var state = stream._readableState;

  if (state.flowing) {
    // https://github.com/isaacs/readable-stream/issues/16
    throw new Error('Cannot switch to old mode now.');
  }

  var paused = startPaused || false;
  var readable = false;

  // convert to an old-style stream.
  stream.readable = true;
  stream.pipe = Stream.prototype.pipe;
  stream.on = stream.addListener = Stream.prototype.on;

  stream.on('readable', function() {
    readable = true;

    var c;
    while (!paused && (null !== (c = stream.read())))
      stream.emit('data', c);

    if (c === null) {
      readable = false;
      stream._readableState.needReadable = true;
    }
  });

  stream.pause = function() {
    paused = true;
    this.emit('pause');
  };

  stream.resume = function() {
    paused = false;
    if (readable)
      process.nextTick(function() {
        stream.emit('readable');
      });
    else
      this.read(0);
    this.emit('resume');
  };

  // now make it start, just in case it hadn't already.
  stream.emit('readable');
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    if (state.decoder)
      chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    //if (state.objectMode && util.isNullOrUndefined(chunk))
    if (state.objectMode && (chunk === null || chunk === undefined))
      return;
    else if (!state.objectMode && (!chunk || !chunk.length))
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (typeof stream[i] === 'function' &&
        typeof this[i] === 'undefined') {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted && state.calledRead) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"_process":10,"buffer":2,"core-util-is":56,"events":6,"inherits":43,"isarray":57,"stream":28,"string_decoder/":58}],54:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined)
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  var ts = this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('finish', function() {
    if ('function' === typeof this._flush)
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var rs = stream._readableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":51,"core-util-is":56,"inherits":43}],55:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : 16 * 1024;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, becuase any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!Buffer.isBuffer(chunk) &&
      'string' !== typeof chunk &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (typeof cb !== 'function')
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb))
    ret = writeOrBuffer(this, state, chunk, encoding, cb);

  return ret;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      cb(er);
    });
  else
    cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished && !state.bufferProcessing && state.buffer.length)
      clearBuffer(stream, state);

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  cb();
  if (finished)
    finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  for (var c = 0; c < state.buffer.length; c++) {
    var entry = state.buffer[c];
    var chunk = entry.chunk;
    var encoding = entry.encoding;
    var cb = entry.callback;
    var len = state.objectMode ? 1 : chunk.length;

    doWrite(stream, state, len, chunk, encoding, cb);

    // if we didn't call the onwrite immediately, then
    // it means that we need to wait until it does.
    // also, that means that the chunk and cb are currently
    // being processed, so move the buffer counter past them.
    if (state.writing) {
      c++;
      break;
    }
  }

  state.bufferProcessing = false;
  if (c < state.buffer.length)
    state.buffer = state.buffer.slice(c);
  else
    state.buffer.length = 0;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (typeof chunk !== 'undefined' && chunk !== null)
    this.write(chunk, encoding);

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    state.finished = true;
    stream.emit('finish');
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))
},{"./_stream_duplex":51,"_process":10,"buffer":2,"core-util-is":56,"inherits":43,"stream":28}],56:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,{"isBuffer":require("../../../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js")})
},{"../../../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js":8}],57:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],58:[function(require,module,exports){
arguments[4][29][0].apply(exports,arguments)
},{"buffer":2,"dup":29}],59:[function(require,module,exports){
var Stream = require('stream'); // hack to fix a circular dependency issue when used with browserify
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":51,"./lib/_stream_passthrough.js":52,"./lib/_stream_readable.js":53,"./lib/_stream_transform.js":54,"./lib/_stream_writable.js":55,"stream":28}],60:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_transform.js":54,"dup":26}],61:[function(require,module,exports){
(function (process,Buffer){
var stream = require('readable-stream')
var eos = require('end-of-stream')
var util = require('util')

var SIGNAL_FLUSH = new Buffer([0])

var onuncork = function(self, fn) {
  if (self._corked) self.once('uncork', fn)
  else fn()
}

var destroyer = function(self, end) {
  return function(err) {
    if (err) self.destroy(err.message === 'premature close' ? null : err)
    else if (end && !self._ended) self.end()
  }
}

var end = function(ws, fn) {
  if (!ws) return fn()
  if (ws._writableState && ws._writableState.finished) return fn()
  if (ws._writableState) return ws.end(fn)
  ws.end()
  fn()
}

var toStreams2 = function(rs) {
  return new (stream.Readable)({objectMode:true, highWaterMark:16}).wrap(rs)
}

var Duplexify = function(writable, readable, opts) {
  if (!(this instanceof Duplexify)) return new Duplexify(writable, readable, opts)
  stream.Duplex.call(this, opts)

  this._writable = null
  this._readable = null
  this._readable2 = null

  this._forwardDestroy = !opts || opts.destroy !== false
  this._forwardEnd = !opts || opts.end !== false
  this._corked = 1 // start corked
  this._ondrain = null
  this._drained = false
  this._forwarding = false
  this._unwrite = null
  this._unread = null
  this._ended = false

  this.destroyed = false

  if (writable) this.setWritable(writable)
  if (readable) this.setReadable(readable)
}

util.inherits(Duplexify, stream.Duplex)

Duplexify.obj = function(writable, readable, opts) {
  if (!opts) opts = {}
  opts.objectMode = true
  opts.highWaterMark = 16
  return new Duplexify(writable, readable, opts)
}

Duplexify.prototype.cork = function() {
  if (++this._corked === 1) this.emit('cork')
}

Duplexify.prototype.uncork = function() {
  if (this._corked && --this._corked === 0) this.emit('uncork')
}

Duplexify.prototype.setWritable = function(writable) {
  if (this._unwrite) this._unwrite()

  if (this.destroyed) {
    if (writable && writable.destroy) writable.destroy()
    return
  }

  if (writable === null || writable === false) {
    this.end()
    return
  }

  var self = this
  var unend = eos(writable, {writable:true, readable:false}, destroyer(this, this._forwardEnd))

  var ondrain = function() {
    var ondrain = self._ondrain
    self._ondrain = null
    if (ondrain) ondrain()
  }

  var clear = function() {
    self._writable.removeListener('drain', ondrain)
    unend()
  }

  if (this._unwrite) process.nextTick(ondrain) // force a drain on stream reset to avoid livelocks

  this._writable = writable
  this._writable.on('drain', ondrain)
  this._unwrite = clear

  this.uncork() // always uncork setWritable
}

Duplexify.prototype.setReadable = function(readable) {
  if (this._unread) this._unread()

  if (this.destroyed) {
    if (readable && readable.destroy) readable.destroy()
    return
  }

  if (readable === null || readable === false) {
    this.push(null)
    this.resume()
    return
  }

  var self = this
  var unend = eos(readable, {writable:false, readable:true}, destroyer(this))

  var onreadable = function() {
    self._forward()
  }

  var onend = function() {
    self.push(null)
  }

  var clear = function() {
    self._readable2.removeListener('readable', onreadable)
    self._readable2.removeListener('end', onend)
    unend()
  }

  this._drained = true
  this._readable = readable
  this._readable2 = readable._readableState ? readable : toStreams2(readable)
  this._readable2.on('readable', onreadable)
  this._readable2.on('end', onend)
  this._unread = clear

  this._forward()
}

Duplexify.prototype._read = function() {
  this._drained = true
  this._forward()
}

Duplexify.prototype._forward = function() {
  if (this._forwarding || !this._readable2 || !this._drained) return
  this._forwarding = true

  var data
  var state = this._readable2._readableState

  while ((data = this._readable2.read(state.buffer.length ? state.buffer[0].length : state.length)) !== null) {
    this._drained = this.push(data)
  }

  this._forwarding = false
}

Duplexify.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true

  var self = this
  process.nextTick(function() {
    self._destroy(err)
  })
}

Duplexify.prototype._destroy = function(err) {
  if (err) {
    var ondrain = this._ondrain
    this._ondrain = null
    if (ondrain) ondrain(err)
    else this.emit('error', err)
  }

  if (this._forwardDestroy) {
    if (this._readable && this._readable.destroy) this._readable.destroy()
    if (this._writable && this._writable.destroy) this._writable.destroy()
  }

  this.emit('close')
}

Duplexify.prototype._write = function(data, enc, cb) {
  if (this.destroyed) return cb()
  if (this._corked) return onuncork(this, this._write.bind(this, data, enc, cb))
  if (data === SIGNAL_FLUSH) return this._finish(cb)
  if (!this._writable) return cb()

  if (this._writable.write(data) === false) this._ondrain = cb
  else cb()
}


Duplexify.prototype._finish = function(cb) {
  var self = this
  this.emit('preend')
  onuncork(this, function() {
    end(self._forwardEnd && self._writable, function() {
      // haxx to not emit prefinish twice
      if (self._writableState.prefinished === false) self._writableState.prefinished = true
      self.emit('prefinish')
      onuncork(self, cb)
    })
  })
}

Duplexify.prototype.end = function(data, enc, cb) {
  if (typeof data === 'function') return this.end(null, null, data)
  if (typeof enc === 'function') return this.end(data, null, enc)
  this._ended = true
  if (data) this.write(data)
  if (!this._writableState.ending) this.write(SIGNAL_FLUSH)
  return stream.Writable.prototype.end.call(this, cb)
}

module.exports = Duplexify
}).call(this,require('_process'),require("buffer").Buffer)
},{"_process":10,"buffer":2,"end-of-stream":62,"readable-stream":75,"util":32}],62:[function(require,module,exports){
var once = require('once');

var noop = function() {};

var isRequest = function(stream) {
	return stream.setHeader && typeof stream.abort === 'function';
};

var eos = function(stream, opts, callback) {
	if (typeof opts === 'function') return eos(stream, null, opts);
	if (!opts) opts = {};

	callback = once(callback || noop);

	var ws = stream._writableState;
	var rs = stream._readableState;
	var readable = opts.readable || (opts.readable !== false && stream.readable);
	var writable = opts.writable || (opts.writable !== false && stream.writable);

	var onlegacyfinish = function() {
		if (!stream.writable) onfinish();
	};

	var onfinish = function() {
		writable = false;
		if (!readable) callback();
	};

	var onend = function() {
		readable = false;
		if (!writable) callback();
	};

	var onclose = function() {
		if (readable && !(rs && rs.ended)) return callback(new Error('premature close'));
		if (writable && !(ws && ws.ended)) return callback(new Error('premature close'));
	};

	var onrequest = function() {
		stream.req.on('finish', onfinish);
	};

	if (isRequest(stream)) {
		stream.on('complete', onfinish);
		stream.on('abort', onclose);
		if (stream.req) onrequest();
		else stream.on('request', onrequest);
	} else if (writable && !ws) { // legacy streams
		stream.on('end', onlegacyfinish);
		stream.on('close', onlegacyfinish);
	}

	stream.on('end', onend);
	stream.on('finish', onfinish);
	if (opts.error !== false) stream.on('error', callback);
	stream.on('close', onclose);

	return function() {
		stream.removeListener('complete', onfinish);
		stream.removeListener('abort', onclose);
		stream.removeListener('request', onrequest);
		if (stream.req) stream.req.removeListener('finish', onfinish);
		stream.removeListener('end', onlegacyfinish);
		stream.removeListener('close', onlegacyfinish);
		stream.removeListener('finish', onfinish);
		stream.removeListener('end', onend);
		stream.removeListener('error', callback);
		stream.removeListener('close', onclose);
	};
};

module.exports = eos;
},{"once":64}],63:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"dup":41}],64:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"dup":42,"wrappy":63}],65:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"./_stream_readable":67,"./_stream_writable":69,"core-util-is":70,"dup":16,"inherits":43,"process-nextick-args":72}],66:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"./_stream_transform":68,"core-util-is":70,"dup":17,"inherits":43}],67:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./_stream_duplex":65,"_process":10,"buffer":2,"core-util-is":70,"dup":18,"events":6,"inherits":43,"isarray":71,"process-nextick-args":72,"string_decoder/":73,"util":1}],68:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"./_stream_duplex":65,"core-util-is":70,"dup":19,"inherits":43}],69:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"./_stream_duplex":65,"buffer":2,"core-util-is":70,"dup":20,"events":6,"inherits":43,"process-nextick-args":72,"util-deprecate":74}],70:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,{"isBuffer":require("../../../../../../../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js")})
},{"../../../../../../../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js":8}],71:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],72:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"_process":10,"dup":22}],73:[function(require,module,exports){
arguments[4][29][0].apply(exports,arguments)
},{"buffer":2,"dup":29}],74:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"dup":23}],75:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":65,"./lib/_stream_passthrough.js":66,"./lib/_stream_readable.js":67,"./lib/_stream_transform.js":68,"./lib/_stream_writable.js":69,"dup":25}],76:[function(require,module,exports){
(function (process){
var Transform = require('readable-stream/transform')
  , inherits  = require('util').inherits
  , xtend     = require('xtend')

function DestroyableTransform(opts) {
  Transform.call(this, opts)
  this._destroyed = false
}

inherits(DestroyableTransform, Transform)

DestroyableTransform.prototype.destroy = function(err) {
  if (this._destroyed) return
  this._destroyed = true
  
  var self = this
  process.nextTick(function() {
    if (err)
      self.emit('error', err)
    self.emit('close')
  })
}

// a noop _transform function
function noop (chunk, enc, callback) {
  callback(null, chunk)
}


// create a new export function, used by both the main export and
// the .ctor export, contains common logic for dealing with arguments
function through2 (construct) {
  return function (options, transform, flush) {
    if (typeof options == 'function') {
      flush     = transform
      transform = options
      options   = {}
    }

    if (typeof transform != 'function')
      transform = noop

    if (typeof flush != 'function')
      flush = null

    return construct(options, transform, flush)
  }
}


// main export, just make me a transform stream!
module.exports = through2(function (options, transform, flush) {
  var t2 = new DestroyableTransform(options)

  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})


// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call
module.exports.ctor = through2(function (options, transform, flush) {
  function Through2 (override) {
    if (!(this instanceof Through2))
      return new Through2(override)

    this.options = xtend(options, override)

    DestroyableTransform.call(this, this.options)
  }

  inherits(Through2, DestroyableTransform)

  Through2.prototype._transform = transform

  if (flush)
    Through2.prototype._flush = flush

  return Through2
})


module.exports.obj = through2(function (options, transform, flush) {
  var t2 = new DestroyableTransform(xtend({ objectMode: true, highWaterMark: 16 }, options))

  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})

}).call(this,require('_process'))
},{"_process":10,"readable-stream/transform":60,"util":32,"xtend":79}],77:[function(require,module,exports){

/**
 * Module dependencies.
 */

var global = (function() { return this; })();

/**
 * WebSocket constructor.
 */

var WebSocket = global.WebSocket || global.MozWebSocket;

/**
 * Module exports.
 */

module.exports = WebSocket ? ws : null;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @param {Object) opts (optional)
 * @api public
 */

function ws(uri, protocols, opts) {
  var instance;
  if (protocols) {
    instance = new WebSocket(uri, protocols);
  } else {
    instance = new WebSocket(uri);
  }
  return instance;
}

if (WebSocket) ws.prototype = WebSocket.prototype;

},{}],78:[function(require,module,exports){
(function (process,Buffer){
var through = require('through2')
var duplexify = require('duplexify')
var WS = require('ws')

module.exports = WebSocketStream

function WebSocketStream(target, protocols) {
  var stream, socket
  var socketWrite = process.title === 'browser' ? socketWriteBrowser : socketWriteNode
  var proxy = through.obj(socketWrite, socketEnd)

  // use existing WebSocket object that was passed in
  if (typeof target === 'object') {
    socket = target
  // otherwise make a new one
  } else {
    socket = new WS(target, protocols)
    socket.binaryType = 'arraybuffer'
  }

  // was already open when passed in
  if (socket.readyState === 1) {
    stream = proxy
  } else {
    stream = duplexify.obj()
    socket.addEventListener("open", onready)
  }

  stream.socket = socket

  socket.addEventListener("close", onclose)
  socket.addEventListener("error", onerror)
  socket.addEventListener("message", onmessage)

  proxy.on('close', destroy)

  function socketWriteNode(chunk, enc, next) {
    socket.send(chunk, next)
  }

  function socketWriteBrowser(chunk, enc, next) {
    try {
      socket.send(chunk)
    } catch(err) {
      return next(err)
    }

    next()
  }

  function socketEnd(done) {
    socket.close()
    done()
  }

  function onready() {
    stream.setReadable(proxy)
    stream.setWritable(proxy)
    stream.emit('connect')
  }

  function onclose() {
    stream.end();
    stream.destroy()
  }

  function onerror(err) {
    stream.destroy(err)
  }

  function onmessage(event) {
    var data = event.data
    if (data instanceof ArrayBuffer) data = new Buffer(new Uint8Array(data))
    else data = new Buffer(data)
    proxy.push(data)
  }

  function destroy() {
    socket.close()
  }

  return stream
}

}).call(this,require('_process'),require("buffer").Buffer)
},{"_process":10,"buffer":2,"duplexify":61,"through2":76,"ws":77}],79:[function(require,module,exports){
module.exports = extend

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}],80:[function(require,module,exports){
/*
	Ractive.js v0.7.3
	Sat Apr 25 2015 13:52:38 GMT-0400 (EDT) - commit da40f81c660ba2f09c45a09a9c20fdd34ee36d80

	http://ractivejs.org
	http://twitter.com/RactiveJS

	Released under the MIT License.
*/

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  global.Ractive = factory()
}(this, function () { 'use strict';

  var TEMPLATE_VERSION = 3;

  var defaultOptions = {

  	// render placement:
  	el: void 0,
  	append: false,

  	// template:
  	template: { v: TEMPLATE_VERSION, t: [] },

  	// parse:     // TODO static delimiters?
  	preserveWhitespace: false,
  	sanitize: false,
  	stripComments: true,
  	delimiters: ["{{", "}}"],
  	tripleDelimiters: ["{{{", "}}}"],
  	interpolate: false,

  	// data & binding:
  	data: {},
  	computed: {},
  	magic: false,
  	modifyArrays: true,
  	adapt: [],
  	isolated: false,
  	twoway: true,
  	lazy: false,

  	// transitions:
  	noIntro: false,
  	transitionsEnabled: true,
  	complete: void 0,

  	// css:
  	css: null,
  	noCssTransform: false
  };

  var config_defaults = defaultOptions;

  // These are a subset of the easing equations found at
  // https://raw.github.com/danro/easing-js - license info
  // follows:

  // --------------------------------------------------
  // easing.js v0.5.4
  // Generic set of easing functions with AMD support
  // https://github.com/danro/easing-js
  // This code may be freely distributed under the MIT license
  // http://danro.mit-license.org/
  // --------------------------------------------------
  // All functions adapted from Thomas Fuchs & Jeremy Kahn
  // Easing Equations (c) 2003 Robert Penner, BSD license
  // https://raw.github.com/danro/easing-js/master/LICENSE
  // --------------------------------------------------

  // In that library, the functions named easeIn, easeOut, and
  // easeInOut below are named easeInCubic, easeOutCubic, and
  // (you guessed it) easeInOutCubic.
  //
  // You can add additional easing functions to this list, and they
  // will be globally available.

  var static_easing = {
  	linear: function (pos) {
  		return pos;
  	},
  	easeIn: function (pos) {
  		return Math.pow(pos, 3);
  	},
  	easeOut: function (pos) {
  		return Math.pow(pos - 1, 3) + 1;
  	},
  	easeInOut: function (pos) {
  		if ((pos /= 0.5) < 1) {
  			return 0.5 * Math.pow(pos, 3);
  		}
  		return 0.5 * (Math.pow(pos - 2, 3) + 2);
  	}
  };

  /*global console, navigator */
  var isClient, isJsdom, hasConsole, environment__magic, namespaces, svg, vendors;

  isClient = typeof document === "object";

  isJsdom = typeof navigator !== "undefined" && /jsDom/.test(navigator.appName);

  hasConsole = typeof console !== "undefined" && typeof console.warn === "function" && typeof console.warn.apply === "function";

  try {
  	Object.defineProperty({}, "test", { value: 0 });
  	environment__magic = true;
  } catch (e) {
  	environment__magic = false;
  }

  namespaces = {
  	html: "http://www.w3.org/1999/xhtml",
  	mathml: "http://www.w3.org/1998/Math/MathML",
  	svg: "http://www.w3.org/2000/svg",
  	xlink: "http://www.w3.org/1999/xlink",
  	xml: "http://www.w3.org/XML/1998/namespace",
  	xmlns: "http://www.w3.org/2000/xmlns/"
  };

  if (typeof document === "undefined") {
  	svg = false;
  } else {
  	svg = document && document.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#BasicStructure", "1.1");
  }

  vendors = ["o", "ms", "moz", "webkit"];

  var createElement, matches, dom__div, methodNames, unprefixed, prefixed, dom__i, j, makeFunction;

  // Test for SVG support
  if (!svg) {
  	createElement = function (type, ns) {
  		if (ns && ns !== namespaces.html) {
  			throw "This browser does not support namespaces other than http://www.w3.org/1999/xhtml. The most likely cause of this error is that you're trying to render SVG in an older browser. See http://docs.ractivejs.org/latest/svg-and-older-browsers for more information";
  		}

  		return document.createElement(type);
  	};
  } else {
  	createElement = function (type, ns) {
  		if (!ns || ns === namespaces.html) {
  			return document.createElement(type);
  		}

  		return document.createElementNS(ns, type);
  	};
  }

  function getElement(input) {
  	var output;

  	if (!input || typeof input === "boolean") {
  		return;
  	}

  	if (typeof window === "undefined" || !document || !input) {
  		return null;
  	}

  	// We already have a DOM node - no work to do. (Duck typing alert!)
  	if (input.nodeType) {
  		return input;
  	}

  	// Get node from string
  	if (typeof input === "string") {
  		// try ID first
  		output = document.getElementById(input);

  		// then as selector, if possible
  		if (!output && document.querySelector) {
  			output = document.querySelector(input);
  		}

  		// did it work?
  		if (output && output.nodeType) {
  			return output;
  		}
  	}

  	// If we've been given a collection (jQuery, Zepto etc), extract the first item
  	if (input[0] && input[0].nodeType) {
  		return input[0];
  	}

  	return null;
  }

  if (!isClient) {
  	matches = null;
  } else {
  	dom__div = createElement("div");
  	methodNames = ["matches", "matchesSelector"];

  	makeFunction = function (methodName) {
  		return function (node, selector) {
  			return node[methodName](selector);
  		};
  	};

  	dom__i = methodNames.length;

  	while (dom__i-- && !matches) {
  		unprefixed = methodNames[dom__i];

  		if (dom__div[unprefixed]) {
  			matches = makeFunction(unprefixed);
  		} else {
  			j = vendors.length;
  			while (j--) {
  				prefixed = vendors[dom__i] + unprefixed.substr(0, 1).toUpperCase() + unprefixed.substring(1);

  				if (dom__div[prefixed]) {
  					matches = makeFunction(prefixed);
  					break;
  				}
  			}
  		}
  	}

  	// IE8...
  	if (!matches) {
  		matches = function (node, selector) {
  			var nodes, parentNode, i;

  			parentNode = node.parentNode;

  			if (!parentNode) {
  				// empty dummy <div>
  				dom__div.innerHTML = "";

  				parentNode = dom__div;
  				node = node.cloneNode();

  				dom__div.appendChild(node);
  			}

  			nodes = parentNode.querySelectorAll(selector);

  			i = nodes.length;
  			while (i--) {
  				if (nodes[i] === node) {
  					return true;
  				}
  			}

  			return false;
  		};
  	}
  }

  function detachNode(node) {
  	if (node && typeof node.parentNode !== "unknown" && node.parentNode) {
  		node.parentNode.removeChild(node);
  	}

  	return node;
  }

  function safeToStringValue(value) {
  	return value == null || !value.toString ? "" : value;
  }

  var legacy = null;

  var create, defineProperty, defineProperties;

  try {
  	Object.defineProperty({}, "test", { value: 0 });

  	if (isClient) {
  		Object.defineProperty(document.createElement("div"), "test", { value: 0 });
  	}

  	defineProperty = Object.defineProperty;
  } catch (err) {
  	// Object.defineProperty doesn't exist, or we're in IE8 where you can
  	// only use it with DOM objects (what were you smoking, MSFT?)
  	defineProperty = function (obj, prop, desc) {
  		obj[prop] = desc.value;
  	};
  }

  try {
  	try {
  		Object.defineProperties({}, { test: { value: 0 } });
  	} catch (err) {
  		// TODO how do we account for this? noMagic = true;
  		throw err;
  	}

  	if (isClient) {
  		Object.defineProperties(createElement("div"), { test: { value: 0 } });
  	}

  	defineProperties = Object.defineProperties;
  } catch (err) {
  	defineProperties = function (obj, props) {
  		var prop;

  		for (prop in props) {
  			if (props.hasOwnProperty(prop)) {
  				defineProperty(obj, prop, props[prop]);
  			}
  		}
  	};
  }

  try {
  	Object.create(null);

  	create = Object.create;
  } catch (err) {
  	// sigh
  	create = (function () {
  		var F = function () {};

  		return function (proto, props) {
  			var obj;

  			if (proto === null) {
  				return {};
  			}

  			F.prototype = proto;
  			obj = new F();

  			if (props) {
  				Object.defineProperties(obj, props);
  			}

  			return obj;
  		};
  	})();
  }

  function utils_object__extend(target) {
  	for (var _len = arguments.length, sources = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  		sources[_key - 1] = arguments[_key];
  	}

  	var prop, source;

  	while (source = sources.shift()) {
  		for (prop in source) {
  			if (hasOwn.call(source, prop)) {
  				target[prop] = source[prop];
  			}
  		}
  	}

  	return target;
  }

  function fillGaps(target) {
  	for (var _len = arguments.length, sources = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  		sources[_key - 1] = arguments[_key];
  	}

  	sources.forEach(function (s) {
  		for (var key in s) {
  			if (s.hasOwnProperty(key) && !(key in target)) {
  				target[key] = s[key];
  			}
  		}
  	});

  	return target;
  }

  var hasOwn = Object.prototype.hasOwnProperty;

  // thanks, http://perfectionkills.com/instanceof-considered-harmful-or-how-to-write-a-robust-isarray/
  var is__toString = Object.prototype.toString,
      arrayLikePattern = /^\[object (?:Array|FileList)\]$/;
  function isArray(thing) {
  	return is__toString.call(thing) === "[object Array]";
  }

  function isArrayLike(obj) {
  	return arrayLikePattern.test(is__toString.call(obj));
  }

  function isEqual(a, b) {
  	if (a === null && b === null) {
  		return true;
  	}

  	if (typeof a === "object" || typeof b === "object") {
  		return false;
  	}

  	return a === b;
  }

  function is__isNumeric(thing) {
  	return !isNaN(parseFloat(thing)) && isFinite(thing);
  }

  function isObject(thing) {
  	return thing && is__toString.call(thing) === "[object Object]";
  }

  var noop = function () {};

  /* global console */
  var alreadyWarned = {},
      log,
      printWarning,
      welcome;

  if (hasConsole) {
  	(function () {
  		var welcomeIntro = ["%cRactive.js %c0.7.3 %cin debug mode, %cmore...", "color: rgb(114, 157, 52); font-weight: normal;", "color: rgb(85, 85, 85); font-weight: normal;", "color: rgb(85, 85, 85); font-weight: normal;", "color: rgb(82, 140, 224); font-weight: normal; text-decoration: underline;"];
  		var welcomeMessage = "You're running Ractive 0.7.3 in debug mode - messages will be printed to the console to help you fix problems and optimise your application.\n\nTo disable debug mode, add this line at the start of your app:\n  Ractive.DEBUG = false;\n\nTo disable debug mode when your app is minified, add this snippet:\n  Ractive.DEBUG = /unminified/.test(function(){/*unminified*/});\n\nGet help and support:\n  http://docs.ractivejs.org\n  http://stackoverflow.com/questions/tagged/ractivejs\n  http://groups.google.com/forum/#!forum/ractive-js\n  http://twitter.com/ractivejs\n\nFound a bug? Raise an issue:\n  https://github.com/ractivejs/ractive/issues\n\n";

  		welcome = function () {
  			var hasGroup = !!console.groupCollapsed;
  			console[hasGroup ? "groupCollapsed" : "log"].apply(console, welcomeIntro);
  			console.log(welcomeMessage);
  			if (hasGroup) {
  				console.groupEnd(welcomeIntro);
  			}

  			welcome = noop;
  		};

  		printWarning = function (message, args) {
  			welcome();

  			// extract information about the instance this message pertains to, if applicable
  			if (typeof args[args.length - 1] === "object") {
  				var options = args.pop();
  				var ractive = options ? options.ractive : null;

  				if (ractive) {
  					// if this is an instance of a component that we know the name of, add
  					// it to the message
  					var _name = undefined;
  					if (ractive.component && (_name = ractive.component.name)) {
  						message = "<" + _name + "> " + message;
  					}

  					var node = undefined;
  					if (node = options.node || ractive.fragment && ractive.fragment.rendered && ractive.find("*")) {
  						args.push(node);
  					}
  				}
  			}

  			console.warn.apply(console, ["%cRactive.js: %c" + message, "color: rgb(114, 157, 52);", "color: rgb(85, 85, 85);"].concat(args));
  		};

  		log = function () {
  			console.log.apply(console, arguments);
  		};
  	})();
  } else {
  	printWarning = log = welcome = noop;
  }

  function format(message, args) {
  	return message.replace(/%s/g, function () {
  		return args.shift();
  	});
  }

  function fatal(message) {
  	for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  		args[_key - 1] = arguments[_key];
  	}

  	message = format(message, args);
  	throw new Error(message);
  }

  function logIfDebug() {
  	if (_Ractive.DEBUG) {
  		log.apply(null, arguments);
  	}
  }

  function warn(message) {
  	for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  		args[_key - 1] = arguments[_key];
  	}

  	message = format(message, args);
  	printWarning(message, args);
  }

  function warnOnce(message) {
  	for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  		args[_key - 1] = arguments[_key];
  	}

  	message = format(message, args);

  	if (alreadyWarned[message]) {
  		return;
  	}

  	alreadyWarned[message] = true;
  	printWarning(message, args);
  }

  function warnIfDebug() {
  	if (_Ractive.DEBUG) {
  		warn.apply(null, arguments);
  	}
  }

  function warnOnceIfDebug() {
  	if (_Ractive.DEBUG) {
  		warnOnce.apply(null, arguments);
  	}
  }

  // Error messages that are used (or could be) in multiple places
  var badArguments = "Bad arguments";
  var noRegistryFunctionReturn = "A function was specified for \"%s\" %s, but no %s was returned";
  var missingPlugin = function (name, type) {
    return "Missing \"" + name + "\" " + type + " plugin. You may need to download a plugin via http://docs.ractivejs.org/latest/plugins#" + type + "s";
  };

  function findInViewHierarchy(registryName, ractive, name) {
  	var instance = findInstance(registryName, ractive, name);
  	return instance ? instance[registryName][name] : null;
  }

  function findInstance(registryName, ractive, name) {
  	while (ractive) {
  		if (name in ractive[registryName]) {
  			return ractive;
  		}

  		if (ractive.isolated) {
  			return null;
  		}

  		ractive = ractive.parent;
  	}
  }

  var interpolate = function (from, to, ractive, type) {
  	if (from === to) {
  		return snap(to);
  	}

  	if (type) {

  		var interpol = findInViewHierarchy("interpolators", ractive, type);
  		if (interpol) {
  			return interpol(from, to) || snap(to);
  		}

  		fatal(missingPlugin(type, "interpolator"));
  	}

  	return static_interpolators.number(from, to) || static_interpolators.array(from, to) || static_interpolators.object(from, to) || snap(to);
  };

  var shared_interpolate = interpolate;

  function snap(to) {
  	return function () {
  		return to;
  	};
  }

  var interpolators = {
  	number: function (from, to) {
  		var delta;

  		if (!is__isNumeric(from) || !is__isNumeric(to)) {
  			return null;
  		}

  		from = +from;
  		to = +to;

  		delta = to - from;

  		if (!delta) {
  			return function () {
  				return from;
  			};
  		}

  		return function (t) {
  			return from + t * delta;
  		};
  	},

  	array: function (from, to) {
  		var intermediate, interpolators, len, i;

  		if (!isArray(from) || !isArray(to)) {
  			return null;
  		}

  		intermediate = [];
  		interpolators = [];

  		i = len = Math.min(from.length, to.length);
  		while (i--) {
  			interpolators[i] = shared_interpolate(from[i], to[i]);
  		}

  		// surplus values - don't interpolate, but don't exclude them either
  		for (i = len; i < from.length; i += 1) {
  			intermediate[i] = from[i];
  		}

  		for (i = len; i < to.length; i += 1) {
  			intermediate[i] = to[i];
  		}

  		return function (t) {
  			var i = len;

  			while (i--) {
  				intermediate[i] = interpolators[i](t);
  			}

  			return intermediate;
  		};
  	},

  	object: function (from, to) {
  		var properties, len, interpolators, intermediate, prop;

  		if (!isObject(from) || !isObject(to)) {
  			return null;
  		}

  		properties = [];
  		intermediate = {};
  		interpolators = {};

  		for (prop in from) {
  			if (hasOwn.call(from, prop)) {
  				if (hasOwn.call(to, prop)) {
  					properties.push(prop);
  					interpolators[prop] = shared_interpolate(from[prop], to[prop]);
  				} else {
  					intermediate[prop] = from[prop];
  				}
  			}
  		}

  		for (prop in to) {
  			if (hasOwn.call(to, prop) && !hasOwn.call(from, prop)) {
  				intermediate[prop] = to[prop];
  			}
  		}

  		len = properties.length;

  		return function (t) {
  			var i = len,
  			    prop;

  			while (i--) {
  				prop = properties[i];

  				intermediate[prop] = interpolators[prop](t);
  			}

  			return intermediate;
  		};
  	}
  };

  var static_interpolators = interpolators;

  // This function takes a keypath such as 'foo.bar.baz', and returns
  // all the variants of that keypath that include a wildcard in place
  // of a key, such as 'foo.bar.*', 'foo.*.baz', 'foo.*.*' and so on.
  // These are then checked against the dependants map (ractive.viewmodel.depsMap)
  // to see if any pattern observers are downstream of one or more of
  // these wildcard keypaths (e.g. 'foo.bar.*.status')
  var utils_getPotentialWildcardMatches = getPotentialWildcardMatches;

  var starMaps = {};
  function getPotentialWildcardMatches(keypath) {
  	var keys, starMap, mapper, i, result, wildcardKeypath;

  	keys = keypath.split(".");
  	if (!(starMap = starMaps[keys.length])) {
  		starMap = getStarMap(keys.length);
  	}

  	result = [];

  	mapper = function (star, i) {
  		return star ? "*" : keys[i];
  	};

  	i = starMap.length;
  	while (i--) {
  		wildcardKeypath = starMap[i].map(mapper).join(".");

  		if (!result.hasOwnProperty(wildcardKeypath)) {
  			result.push(wildcardKeypath);
  			result[wildcardKeypath] = true;
  		}
  	}

  	return result;
  }

  // This function returns all the possible true/false combinations for
  // a given number - e.g. for two, the possible combinations are
  // [ true, true ], [ true, false ], [ false, true ], [ false, false ].
  // It does so by getting all the binary values between 0 and e.g. 11
  function getStarMap(num) {
  	var ones = "",
  	    max,
  	    binary,
  	    starMap,
  	    mapper,
  	    i,
  	    j,
  	    l,
  	    map;

  	if (!starMaps[num]) {
  		starMap = [];

  		while (ones.length < num) {
  			ones += 1;
  		}

  		max = parseInt(ones, 2);

  		mapper = function (digit) {
  			return digit === "1";
  		};

  		for (i = 0; i <= max; i += 1) {
  			binary = i.toString(2);
  			while (binary.length < num) {
  				binary = "0" + binary;
  			}

  			map = [];
  			l = binary.length;
  			for (j = 0; j < l; j++) {
  				map.push(mapper(binary[j]));
  			}
  			starMap[i] = map;
  		}

  		starMaps[num] = starMap;
  	}

  	return starMaps[num];
  }

  var refPattern = /\[\s*(\*|[0-9]|[1-9][0-9]+)\s*\]/g;
  var patternPattern = /\*/;
  var keypathCache = {};

  var Keypath = function (str) {
  	var keys = str.split(".");

  	this.str = str;

  	if (str[0] === "@") {
  		this.isSpecial = true;
  		this.value = decodeKeypath(str);
  	}

  	this.firstKey = keys[0];
  	this.lastKey = keys.pop();

  	this.isPattern = patternPattern.test(str);

  	this.parent = str === "" ? null : getKeypath(keys.join("."));
  	this.isRoot = !str;
  };

  Keypath.prototype = {
  	equalsOrStartsWith: function (keypath) {
  		return keypath === this || this.startsWith(keypath);
  	},

  	join: function (str) {
  		return getKeypath(this.isRoot ? String(str) : this.str + "." + str);
  	},

  	replace: function (oldKeypath, newKeypath) {
  		if (this === oldKeypath) {
  			return newKeypath;
  		}

  		if (this.startsWith(oldKeypath)) {
  			return newKeypath === null ? newKeypath : getKeypath(this.str.replace(oldKeypath.str + ".", newKeypath.str + "."));
  		}
  	},

  	startsWith: function (keypath) {
  		if (!keypath) {
  			// TODO under what circumstances does this happen?
  			return false;
  		}

  		return keypath && this.str.substr(0, keypath.str.length + 1) === keypath.str + ".";
  	},

  	toString: function () {
  		throw new Error("Bad coercion");
  	},

  	valueOf: function () {
  		throw new Error("Bad coercion");
  	},

  	wildcardMatches: function () {
  		return this._wildcardMatches || (this._wildcardMatches = utils_getPotentialWildcardMatches(this.str));
  	}
  };
  function assignNewKeypath(target, property, oldKeypath, newKeypath) {
  	var existingKeypath = target[property];

  	if (existingKeypath && (existingKeypath.equalsOrStartsWith(newKeypath) || !existingKeypath.equalsOrStartsWith(oldKeypath))) {
  		return;
  	}

  	target[property] = existingKeypath ? existingKeypath.replace(oldKeypath, newKeypath) : newKeypath;
  	return true;
  }

  function decodeKeypath(keypath) {
  	var value = keypath.slice(2);

  	if (keypath[1] === "i") {
  		return is__isNumeric(value) ? +value : value;
  	} else {
  		return value;
  	}
  }

  function getKeypath(str) {
  	if (str == null) {
  		return str;
  	}

  	// TODO it *may* be worth having two versions of this function - one where
  	// keypathCache inherits from null, and one for IE8. Depends on how
  	// much of an overhead hasOwnProperty is - probably negligible
  	if (!keypathCache.hasOwnProperty(str)) {
  		keypathCache[str] = new Keypath(str);
  	}

  	return keypathCache[str];
  }

  function getMatchingKeypaths(ractive, keypath) {
  	var keys, key, matchingKeypaths;

  	keys = keypath.str.split(".");
  	matchingKeypaths = [rootKeypath];

  	while (key = keys.shift()) {
  		if (key === "*") {
  			// expand to find all valid child keypaths
  			matchingKeypaths = matchingKeypaths.reduce(expand, []);
  		} else {
  			if (matchingKeypaths[0] === rootKeypath) {
  				// first key
  				matchingKeypaths[0] = getKeypath(key);
  			} else {
  				matchingKeypaths = matchingKeypaths.map(concatenate(key));
  			}
  		}
  	}

  	return matchingKeypaths;

  	function expand(matchingKeypaths, keypath) {
  		var wrapper, value, keys;

  		if (keypath.isRoot) {
  			keys = [].concat(Object.keys(ractive.viewmodel.data), Object.keys(ractive.viewmodel.mappings), Object.keys(ractive.viewmodel.computations));
  		} else {
  			wrapper = ractive.viewmodel.wrapped[keypath.str];
  			value = wrapper ? wrapper.get() : ractive.viewmodel.get(keypath);

  			keys = value ? Object.keys(value) : null;
  		}

  		if (keys) {
  			keys.forEach(function (key) {
  				if (key !== "_ractive" || !isArray(value)) {
  					matchingKeypaths.push(keypath.join(key));
  				}
  			});
  		}

  		return matchingKeypaths;
  	}
  }

  function concatenate(key) {
  	return function (keypath) {
  		return keypath.join(key);
  	};
  }
  function normalise(ref) {
  	return ref ? ref.replace(refPattern, ".$1") : "";
  }

  var rootKeypath = getKeypath("");

  var shared_add = add;
  var shared_add__errorMessage = "Cannot add to a non-numeric value";
  function add(root, keypath, d) {
  	if (typeof keypath !== "string" || !is__isNumeric(d)) {
  		throw new Error("Bad arguments");
  	}

  	var value = undefined,
  	    changes = undefined;

  	if (/\*/.test(keypath)) {
  		changes = {};

  		getMatchingKeypaths(root, getKeypath(normalise(keypath))).forEach(function (keypath) {
  			var value = root.viewmodel.get(keypath);

  			if (!is__isNumeric(value)) {
  				throw new Error(shared_add__errorMessage);
  			}

  			changes[keypath.str] = value + d;
  		});

  		return root.set(changes);
  	}

  	value = root.get(keypath);

  	if (!is__isNumeric(value)) {
  		throw new Error(shared_add__errorMessage);
  	}

  	return root.set(keypath, +value + d);
  }

  var prototype_add = Ractive$add;
  function Ractive$add(keypath, d) {
  	return shared_add(this, keypath, d === undefined ? 1 : +d);
  }

  var requestAnimationFrame;

  // If window doesn't exist, we don't need requestAnimationFrame
  if (typeof window === "undefined") {
  	requestAnimationFrame = null;
  } else {
  	// https://gist.github.com/paulirish/1579671
  	(function (vendors, lastTime, window) {

  		var x, setTimeout;

  		if (window.requestAnimationFrame) {
  			return;
  		}

  		for (x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
  			window.requestAnimationFrame = window[vendors[x] + "RequestAnimationFrame"];
  		}

  		if (!window.requestAnimationFrame) {
  			setTimeout = window.setTimeout;

  			window.requestAnimationFrame = function (callback) {
  				var currTime, timeToCall, id;

  				currTime = Date.now();
  				timeToCall = Math.max(0, 16 - (currTime - lastTime));
  				id = setTimeout(function () {
  					callback(currTime + timeToCall);
  				}, timeToCall);

  				lastTime = currTime + timeToCall;
  				return id;
  			};
  		}
  	})(vendors, 0, window);

  	requestAnimationFrame = window.requestAnimationFrame;
  }

  var rAF = requestAnimationFrame;

  var getTime;

  if (typeof window !== "undefined" && window.performance && typeof window.performance.now === "function") {
  	getTime = function () {
  		return window.performance.now();
  	};
  } else {
  	getTime = function () {
  		return Date.now();
  	};
  }

  var utils_getTime = getTime;

  var deprecations = {
  	construct: {
  		deprecated: "beforeInit",
  		replacement: "onconstruct"
  	},
  	render: {
  		deprecated: "init",
  		message: "The \"init\" method has been deprecated " + "and will likely be removed in a future release. " + "You can either use the \"oninit\" method which will fire " + "only once prior to, and regardless of, any eventual ractive " + "instance being rendered, or if you need to access the " + "rendered DOM, use \"onrender\" instead. " + "See http://docs.ractivejs.org/latest/migrating for more information."
  	},
  	complete: {
  		deprecated: "complete",
  		replacement: "oncomplete"
  	}
  };

  function Hook(event) {
  	this.event = event;
  	this.method = "on" + event;
  	this.deprecate = deprecations[event];
  }

  Hook.prototype.fire = function (ractive, arg) {
  	function call(method) {
  		if (ractive[method]) {
  			arg ? ractive[method](arg) : ractive[method]();
  			return true;
  		}
  	}

  	call(this.method);

  	if (!ractive[this.method] && this.deprecate && call(this.deprecate.deprecated)) {
  		if (this.deprecate.message) {
  			warnIfDebug(this.deprecate.message);
  		} else {
  			warnIfDebug("The method \"%s\" has been deprecated in favor of \"%s\" and will likely be removed in a future release. See http://docs.ractivejs.org/latest/migrating for more information.", this.deprecate.deprecated, this.deprecate.replacement);
  		}
  	}

  	arg ? ractive.fire(this.event, arg) : ractive.fire(this.event);
  };

  var hooks_Hook = Hook;

  function addToArray(array, value) {
  	var index = array.indexOf(value);

  	if (index === -1) {
  		array.push(value);
  	}
  }

  function arrayContains(array, value) {
  	for (var i = 0, c = array.length; i < c; i++) {
  		if (array[i] == value) {
  			return true;
  		}
  	}

  	return false;
  }

  function arrayContentsMatch(a, b) {
  	var i;

  	if (!isArray(a) || !isArray(b)) {
  		return false;
  	}

  	if (a.length !== b.length) {
  		return false;
  	}

  	i = a.length;
  	while (i--) {
  		if (a[i] !== b[i]) {
  			return false;
  		}
  	}

  	return true;
  }

  function ensureArray(x) {
  	if (typeof x === "string") {
  		return [x];
  	}

  	if (x === undefined) {
  		return [];
  	}

  	return x;
  }

  function lastItem(array) {
  	return array[array.length - 1];
  }

  function removeFromArray(array, member) {
  	var index = array.indexOf(member);

  	if (index !== -1) {
  		array.splice(index, 1);
  	}
  }

  function toArray(arrayLike) {
  	var array = [],
  	    i = arrayLike.length;
  	while (i--) {
  		array[i] = arrayLike[i];
  	}

  	return array;
  }

  var _Promise,
      PENDING = {},
      FULFILLED = {},
      REJECTED = {};

  if (typeof Promise === "function") {
  	// use native Promise
  	_Promise = Promise;
  } else {
  	_Promise = function (callback) {
  		var fulfilledHandlers = [],
  		    rejectedHandlers = [],
  		    state = PENDING,
  		    result,
  		    dispatchHandlers,
  		    makeResolver,
  		    fulfil,
  		    reject,
  		    promise;

  		makeResolver = function (newState) {
  			return function (value) {
  				if (state !== PENDING) {
  					return;
  				}

  				result = value;
  				state = newState;

  				dispatchHandlers = makeDispatcher(state === FULFILLED ? fulfilledHandlers : rejectedHandlers, result);

  				// dispatch onFulfilled and onRejected handlers asynchronously
  				wait(dispatchHandlers);
  			};
  		};

  		fulfil = makeResolver(FULFILLED);
  		reject = makeResolver(REJECTED);

  		try {
  			callback(fulfil, reject);
  		} catch (err) {
  			reject(err);
  		}

  		promise = {
  			// `then()` returns a Promise - 2.2.7
  			then: function (onFulfilled, onRejected) {
  				var promise2 = new _Promise(function (fulfil, reject) {

  					var processResolutionHandler = function (handler, handlers, forward) {

  						// 2.2.1.1
  						if (typeof handler === "function") {
  							handlers.push(function (p1result) {
  								var x;

  								try {
  									x = handler(p1result);
  									utils_Promise__resolve(promise2, x, fulfil, reject);
  								} catch (err) {
  									reject(err);
  								}
  							});
  						} else {
  							// Forward the result of promise1 to promise2, if resolution handlers
  							// are not given
  							handlers.push(forward);
  						}
  					};

  					// 2.2
  					processResolutionHandler(onFulfilled, fulfilledHandlers, fulfil);
  					processResolutionHandler(onRejected, rejectedHandlers, reject);

  					if (state !== PENDING) {
  						// If the promise has resolved already, dispatch the appropriate handlers asynchronously
  						wait(dispatchHandlers);
  					}
  				});

  				return promise2;
  			}
  		};

  		promise["catch"] = function (onRejected) {
  			return this.then(null, onRejected);
  		};

  		return promise;
  	};

  	_Promise.all = function (promises) {
  		return new _Promise(function (fulfil, reject) {
  			var result = [],
  			    pending,
  			    i,
  			    processPromise;

  			if (!promises.length) {
  				fulfil(result);
  				return;
  			}

  			processPromise = function (promise, i) {
  				if (promise && typeof promise.then === "function") {
  					promise.then(function (value) {
  						result[i] = value;
  						--pending || fulfil(result);
  					}, reject);
  				} else {
  					result[i] = promise;
  					--pending || fulfil(result);
  				}
  			};

  			pending = i = promises.length;
  			while (i--) {
  				processPromise(promises[i], i);
  			}
  		});
  	};

  	_Promise.resolve = function (value) {
  		return new _Promise(function (fulfil) {
  			fulfil(value);
  		});
  	};

  	_Promise.reject = function (reason) {
  		return new _Promise(function (fulfil, reject) {
  			reject(reason);
  		});
  	};
  }

  var utils_Promise = _Promise;

  // TODO use MutationObservers or something to simulate setImmediate
  function wait(callback) {
  	setTimeout(callback, 0);
  }

  function makeDispatcher(handlers, result) {
  	return function () {
  		var handler;

  		while (handler = handlers.shift()) {
  			handler(result);
  		}
  	};
  }

  function utils_Promise__resolve(promise, x, fulfil, reject) {
  	// Promise Resolution Procedure
  	var then;

  	// 2.3.1
  	if (x === promise) {
  		throw new TypeError("A promise's fulfillment handler cannot return the same promise");
  	}

  	// 2.3.2
  	if (x instanceof _Promise) {
  		x.then(fulfil, reject);
  	}

  	// 2.3.3
  	else if (x && (typeof x === "object" || typeof x === "function")) {
  		try {
  			then = x.then; // 2.3.3.1
  		} catch (e) {
  			reject(e); // 2.3.3.2
  			return;
  		}

  		// 2.3.3.3
  		if (typeof then === "function") {
  			var called, resolvePromise, rejectPromise;

  			resolvePromise = function (y) {
  				if (called) {
  					return;
  				}
  				called = true;
  				utils_Promise__resolve(promise, y, fulfil, reject);
  			};

  			rejectPromise = function (r) {
  				if (called) {
  					return;
  				}
  				called = true;
  				reject(r);
  			};

  			try {
  				then.call(x, resolvePromise, rejectPromise);
  			} catch (e) {
  				if (!called) {
  					// 2.3.3.3.4.1
  					reject(e); // 2.3.3.3.4.2
  					called = true;
  					return;
  				}
  			}
  		} else {
  			fulfil(x);
  		}
  	} else {
  		fulfil(x);
  	}
  }

  var getInnerContext = function (fragment) {
  	do {
  		if (fragment.context !== undefined) {
  			return fragment.context;
  		}
  	} while (fragment = fragment.parent);

  	return rootKeypath;
  };

  var shared_resolveRef = resolveRef;

  function resolveRef(ractive, ref, fragment) {
  	var keypath;

  	ref = normalise(ref);

  	// If a reference begins '~/', it's a top-level reference
  	if (ref.substr(0, 2) === "~/") {
  		keypath = getKeypath(ref.substring(2));
  		createMappingIfNecessary(ractive, keypath.firstKey, fragment);
  	}

  	// If a reference begins with '.', it's either a restricted reference or
  	// an ancestor reference...
  	else if (ref[0] === ".") {
  		keypath = resolveAncestorRef(getInnerContext(fragment), ref);

  		if (keypath) {
  			createMappingIfNecessary(ractive, keypath.firstKey, fragment);
  		}
  	}

  	// ...otherwise we need to figure out the keypath based on context
  	else {
  		keypath = resolveAmbiguousReference(ractive, getKeypath(ref), fragment);
  	}

  	return keypath;
  }

  function resolveAncestorRef(baseContext, ref) {
  	var contextKeys;

  	// TODO...
  	if (baseContext != undefined && typeof baseContext !== "string") {
  		baseContext = baseContext.str;
  	}

  	// {{.}} means 'current context'
  	if (ref === ".") return getKeypath(baseContext);

  	contextKeys = baseContext ? baseContext.split(".") : [];

  	// ancestor references (starting "../") go up the tree
  	if (ref.substr(0, 3) === "../") {
  		while (ref.substr(0, 3) === "../") {
  			if (!contextKeys.length) {
  				throw new Error("Could not resolve reference - too many \"../\" prefixes");
  			}

  			contextKeys.pop();
  			ref = ref.substring(3);
  		}

  		contextKeys.push(ref);
  		return getKeypath(contextKeys.join("."));
  	}

  	// not an ancestor reference - must be a restricted reference (prepended with "." or "./")
  	if (!baseContext) {
  		return getKeypath(ref.replace(/^\.\/?/, ""));
  	}

  	return getKeypath(baseContext + ref.replace(/^\.\//, "."));
  }

  function resolveAmbiguousReference(ractive, ref, fragment, isParentLookup) {
  	var context, key, parentValue, hasContextChain, parentKeypath;

  	if (ref.isRoot) {
  		return ref;
  	}

  	key = ref.firstKey;

  	while (fragment) {
  		context = fragment.context;
  		fragment = fragment.parent;

  		if (!context) {
  			continue;
  		}

  		hasContextChain = true;
  		parentValue = ractive.viewmodel.get(context);

  		if (parentValue && (typeof parentValue === "object" || typeof parentValue === "function") && key in parentValue) {
  			return context.join(ref.str);
  		}
  	}

  	// Root/computed/mapped property?
  	if (isRootProperty(ractive.viewmodel, key)) {
  		return ref;
  	}

  	// If this is an inline component, and it's not isolated, we
  	// can try going up the scope chain
  	if (ractive.parent && !ractive.isolated) {
  		hasContextChain = true;
  		fragment = ractive.component.parentFragment;

  		key = getKeypath(key);

  		if (parentKeypath = resolveAmbiguousReference(ractive.parent, key, fragment, true)) {
  			// We need to create an inter-component binding
  			ractive.viewmodel.map(key, {
  				origin: ractive.parent.viewmodel,
  				keypath: parentKeypath
  			});

  			return ref;
  		}
  	}

  	// If there's no context chain, and the instance is either a) isolated or
  	// b) an orphan, then we know that the keypath is identical to the reference
  	if (!isParentLookup && !hasContextChain) {
  		// the data object needs to have a property by this name,
  		// to prevent future failed lookups
  		ractive.viewmodel.set(ref, undefined);
  		return ref;
  	}
  }

  function createMappingIfNecessary(ractive, key) {
  	var parentKeypath;

  	if (!ractive.parent || ractive.isolated || isRootProperty(ractive.viewmodel, key)) {
  		return;
  	}

  	key = getKeypath(key);

  	if (parentKeypath = resolveAmbiguousReference(ractive.parent, key, ractive.component.parentFragment, true)) {
  		ractive.viewmodel.map(key, {
  			origin: ractive.parent.viewmodel,
  			keypath: parentKeypath
  		});
  	}
  }

  function isRootProperty(viewmodel, key) {
  	// special case for reference to root
  	return key === "" || key in viewmodel.data || key in viewmodel.computations || key in viewmodel.mappings;
  }

  function teardown(x) {
    x.teardown();
  }

  function methodCallers__unbind(x) {
    x.unbind();
  }

  function methodCallers__unrender(x) {
    x.unrender();
  }

  function cancel(x) {
    x.cancel();
  }

  var TransitionManager = function (callback, parent) {
  	this.callback = callback;
  	this.parent = parent;

  	this.intros = [];
  	this.outros = [];

  	this.children = [];
  	this.totalChildren = this.outroChildren = 0;

  	this.detachQueue = [];
  	this.decoratorQueue = [];
  	this.outrosComplete = false;

  	if (parent) {
  		parent.addChild(this);
  	}
  };

  TransitionManager.prototype = {
  	addChild: function (child) {
  		this.children.push(child);

  		this.totalChildren += 1;
  		this.outroChildren += 1;
  	},

  	decrementOutros: function () {
  		this.outroChildren -= 1;
  		check(this);
  	},

  	decrementTotal: function () {
  		this.totalChildren -= 1;
  		check(this);
  	},

  	add: function (transition) {
  		var list = transition.isIntro ? this.intros : this.outros;
  		list.push(transition);
  	},

  	addDecorator: function (decorator) {
  		this.decoratorQueue.push(decorator);
  	},

  	remove: function (transition) {
  		var list = transition.isIntro ? this.intros : this.outros;
  		removeFromArray(list, transition);
  		check(this);
  	},

  	init: function () {
  		this.ready = true;
  		check(this);
  	},

  	detachNodes: function () {
  		this.decoratorQueue.forEach(teardown);
  		this.detachQueue.forEach(detach);
  		this.children.forEach(detachNodes);
  	}
  };

  function detach(element) {
  	element.detach();
  }

  function detachNodes(tm) {
  	tm.detachNodes();
  }

  function check(tm) {
  	if (!tm.ready || tm.outros.length || tm.outroChildren) return;

  	// If all outros are complete, and we haven't already done this,
  	// we notify the parent if there is one, otherwise
  	// start detaching nodes
  	if (!tm.outrosComplete) {
  		if (tm.parent) {
  			tm.parent.decrementOutros(tm);
  		} else {
  			tm.detachNodes();
  		}

  		tm.outrosComplete = true;
  	}

  	// Once everything is done, we can notify parent transition
  	// manager and call the callback
  	if (!tm.intros.length && !tm.totalChildren) {
  		if (typeof tm.callback === "function") {
  			tm.callback();
  		}

  		if (tm.parent) {
  			tm.parent.decrementTotal();
  		}
  	}
  }

  var global_TransitionManager = TransitionManager;

  var batch,
      runloop,
      unresolved = [],
      changeHook = new hooks_Hook("change");

  runloop = {
  	start: function (instance, returnPromise) {
  		var promise, fulfilPromise;

  		if (returnPromise) {
  			promise = new utils_Promise(function (f) {
  				return fulfilPromise = f;
  			});
  		}

  		batch = {
  			previousBatch: batch,
  			transitionManager: new global_TransitionManager(fulfilPromise, batch && batch.transitionManager),
  			views: [],
  			tasks: [],
  			ractives: [],
  			instance: instance
  		};

  		if (instance) {
  			batch.ractives.push(instance);
  		}

  		return promise;
  	},

  	end: function () {
  		flushChanges();

  		batch.transitionManager.init();
  		if (!batch.previousBatch && !!batch.instance) batch.instance.viewmodel.changes = [];
  		batch = batch.previousBatch;
  	},

  	addRactive: function (ractive) {
  		if (batch) {
  			addToArray(batch.ractives, ractive);
  		}
  	},

  	registerTransition: function (transition) {
  		transition._manager = batch.transitionManager;
  		batch.transitionManager.add(transition);
  	},

  	registerDecorator: function (decorator) {
  		batch.transitionManager.addDecorator(decorator);
  	},

  	addView: function (view) {
  		batch.views.push(view);
  	},

  	addUnresolved: function (thing) {
  		unresolved.push(thing);
  	},

  	removeUnresolved: function (thing) {
  		removeFromArray(unresolved, thing);
  	},

  	// synchronise node detachments with transition ends
  	detachWhenReady: function (thing) {
  		batch.transitionManager.detachQueue.push(thing);
  	},

  	scheduleTask: function (task, postRender) {
  		var _batch;

  		if (!batch) {
  			task();
  		} else {
  			_batch = batch;
  			while (postRender && _batch.previousBatch) {
  				// this can't happen until the DOM has been fully updated
  				// otherwise in some situations (with components inside elements)
  				// transitions and decorators will initialise prematurely
  				_batch = _batch.previousBatch;
  			}

  			_batch.tasks.push(task);
  		}
  	}
  };

  var global_runloop = runloop;

  function flushChanges() {
  	var i, thing, changeHash;

  	while (batch.ractives.length) {
  		thing = batch.ractives.pop();
  		changeHash = thing.viewmodel.applyChanges();

  		if (changeHash) {
  			changeHook.fire(thing, changeHash);
  		}
  	}

  	attemptKeypathResolution();

  	// Now that changes have been fully propagated, we can update the DOM
  	// and complete other tasks
  	for (i = 0; i < batch.views.length; i += 1) {
  		batch.views[i].update();
  	}
  	batch.views.length = 0;

  	for (i = 0; i < batch.tasks.length; i += 1) {
  		batch.tasks[i]();
  	}
  	batch.tasks.length = 0;

  	// If updating the view caused some model blowback - e.g. a triple
  	// containing <option> elements caused the binding on the <select>
  	// to update - then we start over
  	if (batch.ractives.length) return flushChanges();
  }

  function attemptKeypathResolution() {
  	var i, item, keypath, resolved;

  	i = unresolved.length;

  	// see if we can resolve any unresolved references
  	while (i--) {
  		item = unresolved[i];

  		if (item.keypath) {
  			// it resolved some other way. TODO how? two-way binding? Seems
  			// weird that we'd still end up here
  			unresolved.splice(i, 1);
  			continue; // avoid removing the wrong thing should the next condition be true
  		}

  		if (keypath = shared_resolveRef(item.root, item.ref, item.parentFragment)) {
  			(resolved || (resolved = [])).push({
  				item: item,
  				keypath: keypath
  			});

  			unresolved.splice(i, 1);
  		}
  	}

  	if (resolved) {
  		resolved.forEach(global_runloop__resolve);
  	}
  }

  function global_runloop__resolve(resolved) {
  	resolved.item.resolve(resolved.keypath);
  }

  var queue = [];

  var animations = {
  	tick: function () {
  		var i, animation, now;

  		now = utils_getTime();

  		global_runloop.start();

  		for (i = 0; i < queue.length; i += 1) {
  			animation = queue[i];

  			if (!animation.tick(now)) {
  				// animation is complete, remove it from the stack, and decrement i so we don't miss one
  				queue.splice(i--, 1);
  			}
  		}

  		global_runloop.end();

  		if (queue.length) {
  			rAF(animations.tick);
  		} else {
  			animations.running = false;
  		}
  	},

  	add: function (animation) {
  		queue.push(animation);

  		if (!animations.running) {
  			animations.running = true;
  			rAF(animations.tick);
  		}
  	},

  	// TODO optimise this
  	abort: function (keypath, root) {
  		var i = queue.length,
  		    animation;

  		while (i--) {
  			animation = queue[i];

  			if (animation.root === root && animation.keypath === keypath) {
  				animation.stop();
  			}
  		}
  	}
  };

  var shared_animations = animations;

  var Animation = function (options) {
  	var key;

  	this.startTime = Date.now();

  	// from and to
  	for (key in options) {
  		if (options.hasOwnProperty(key)) {
  			this[key] = options[key];
  		}
  	}

  	this.interpolator = shared_interpolate(this.from, this.to, this.root, this.interpolator);
  	this.running = true;

  	this.tick();
  };

  Animation.prototype = {
  	tick: function () {
  		var elapsed, t, value, timeNow, index, keypath;

  		keypath = this.keypath;

  		if (this.running) {
  			timeNow = Date.now();
  			elapsed = timeNow - this.startTime;

  			if (elapsed >= this.duration) {
  				if (keypath !== null) {
  					global_runloop.start(this.root);
  					this.root.viewmodel.set(keypath, this.to);
  					global_runloop.end();
  				}

  				if (this.step) {
  					this.step(1, this.to);
  				}

  				this.complete(this.to);

  				index = this.root._animations.indexOf(this);

  				// TODO investigate why this happens
  				if (index === -1) {
  					warnIfDebug("Animation was not found");
  				}

  				this.root._animations.splice(index, 1);

  				this.running = false;
  				return false; // remove from the stack
  			}

  			t = this.easing ? this.easing(elapsed / this.duration) : elapsed / this.duration;

  			if (keypath !== null) {
  				value = this.interpolator(t);
  				global_runloop.start(this.root);
  				this.root.viewmodel.set(keypath, value);
  				global_runloop.end();
  			}

  			if (this.step) {
  				this.step(t, value);
  			}

  			return true; // keep in the stack
  		}

  		return false; // remove from the stack
  	},

  	stop: function () {
  		var index;

  		this.running = false;

  		index = this.root._animations.indexOf(this);

  		// TODO investigate why this happens
  		if (index === -1) {
  			warnIfDebug("Animation was not found");
  		}

  		this.root._animations.splice(index, 1);
  	}
  };

  var animate_Animation = Animation;

  var prototype_animate = Ractive$animate;

  var noAnimation = { stop: noop };
  function Ractive$animate(keypath, to, options) {
  	var promise, fulfilPromise, k, animation, animations, easing, duration, step, complete, makeValueCollector, currentValues, collectValue, dummy, dummyOptions;

  	promise = new utils_Promise(function (fulfil) {
  		return fulfilPromise = fulfil;
  	});

  	// animate multiple keypaths
  	if (typeof keypath === "object") {
  		options = to || {};
  		easing = options.easing;
  		duration = options.duration;

  		animations = [];

  		// we don't want to pass the `step` and `complete` handlers, as they will
  		// run for each animation! So instead we'll store the handlers and create
  		// our own...
  		step = options.step;
  		complete = options.complete;

  		if (step || complete) {
  			currentValues = {};

  			options.step = null;
  			options.complete = null;

  			makeValueCollector = function (keypath) {
  				return function (t, value) {
  					currentValues[keypath] = value;
  				};
  			};
  		}

  		for (k in keypath) {
  			if (keypath.hasOwnProperty(k)) {
  				if (step || complete) {
  					collectValue = makeValueCollector(k);
  					options = { easing: easing, duration: duration };

  					if (step) {
  						options.step = collectValue;
  					}
  				}

  				options.complete = complete ? collectValue : noop;
  				animations.push(animate(this, k, keypath[k], options));
  			}
  		}

  		// Create a dummy animation, to facilitate step/complete
  		// callbacks, and Promise fulfilment
  		dummyOptions = { easing: easing, duration: duration };

  		if (step) {
  			dummyOptions.step = function (t) {
  				return step(t, currentValues);
  			};
  		}

  		if (complete) {
  			promise.then(function (t) {
  				return complete(t, currentValues);
  			});
  		}

  		dummyOptions.complete = fulfilPromise;

  		dummy = animate(this, null, null, dummyOptions);
  		animations.push(dummy);

  		promise.stop = function () {
  			var animation;

  			while (animation = animations.pop()) {
  				animation.stop();
  			}

  			if (dummy) {
  				dummy.stop();
  			}
  		};

  		return promise;
  	}

  	// animate a single keypath
  	options = options || {};

  	if (options.complete) {
  		promise.then(options.complete);
  	}

  	options.complete = fulfilPromise;
  	animation = animate(this, keypath, to, options);

  	promise.stop = function () {
  		return animation.stop();
  	};
  	return promise;
  }

  function animate(root, keypath, to, options) {
  	var easing, duration, animation, from;

  	if (keypath) {
  		keypath = getKeypath(normalise(keypath));
  	}

  	if (keypath !== null) {
  		from = root.viewmodel.get(keypath);
  	}

  	// cancel any existing animation
  	// TODO what about upstream/downstream keypaths?
  	shared_animations.abort(keypath, root);

  	// don't bother animating values that stay the same
  	if (isEqual(from, to)) {
  		if (options.complete) {
  			options.complete(options.to);
  		}

  		return noAnimation;
  	}

  	// easing function
  	if (options.easing) {
  		if (typeof options.easing === "function") {
  			easing = options.easing;
  		} else {
  			easing = root.easing[options.easing];
  		}

  		if (typeof easing !== "function") {
  			easing = null;
  		}
  	}

  	// duration
  	duration = options.duration === undefined ? 400 : options.duration;

  	// TODO store keys, use an internal set method
  	animation = new animate_Animation({
  		keypath: keypath,
  		from: from,
  		to: to,
  		root: root,
  		duration: duration,
  		easing: easing,
  		interpolator: options.interpolator,

  		// TODO wrap callbacks if necessary, to use instance as context
  		step: options.step,
  		complete: options.complete
  	});

  	shared_animations.add(animation);
  	root._animations.push(animation);

  	return animation;
  }

  var prototype_detach = Ractive$detach;
  var prototype_detach__detachHook = new hooks_Hook("detach");
  function Ractive$detach() {
  	if (this.detached) {
  		return this.detached;
  	}

  	if (this.el) {
  		removeFromArray(this.el.__ractive_instances__, this);
  	}
  	this.detached = this.fragment.detach();
  	prototype_detach__detachHook.fire(this);
  	return this.detached;
  }

  var prototype_find = Ractive$find;

  function Ractive$find(selector) {
  	if (!this.el) {
  		return null;
  	}

  	return this.fragment.find(selector);
  }

  var test = Query$test;
  function Query$test(item, noDirty) {
  	var itemMatches;

  	if (this._isComponentQuery) {
  		itemMatches = !this.selector || item.name === this.selector;
  	} else {
  		itemMatches = item.node ? matches(item.node, this.selector) : null;
  	}

  	if (itemMatches) {
  		this.push(item.node || item.instance);

  		if (!noDirty) {
  			this._makeDirty();
  		}

  		return true;
  	}
  }

  var makeQuery_cancel = function () {
  	var liveQueries, selector, index;

  	liveQueries = this._root[this._isComponentQuery ? "liveComponentQueries" : "liveQueries"];
  	selector = this.selector;

  	index = liveQueries.indexOf(selector);

  	if (index !== -1) {
  		liveQueries.splice(index, 1);
  		liveQueries[selector] = null;
  	}
  };

  var sortByItemPosition = function (a, b) {
  	var ancestryA, ancestryB, oldestA, oldestB, mutualAncestor, indexA, indexB, fragments, fragmentA, fragmentB;

  	ancestryA = getAncestry(a.component || a._ractive.proxy);
  	ancestryB = getAncestry(b.component || b._ractive.proxy);

  	oldestA = lastItem(ancestryA);
  	oldestB = lastItem(ancestryB);

  	// remove items from the end of both ancestries as long as they are identical
  	// - the final one removed is the closest mutual ancestor
  	while (oldestA && oldestA === oldestB) {
  		ancestryA.pop();
  		ancestryB.pop();

  		mutualAncestor = oldestA;

  		oldestA = lastItem(ancestryA);
  		oldestB = lastItem(ancestryB);
  	}

  	// now that we have the mutual ancestor, we can find which is earliest
  	oldestA = oldestA.component || oldestA;
  	oldestB = oldestB.component || oldestB;

  	fragmentA = oldestA.parentFragment;
  	fragmentB = oldestB.parentFragment;

  	// if both items share a parent fragment, our job is easy
  	if (fragmentA === fragmentB) {
  		indexA = fragmentA.items.indexOf(oldestA);
  		indexB = fragmentB.items.indexOf(oldestB);

  		// if it's the same index, it means one contains the other,
  		// so we see which has the longest ancestry
  		return indexA - indexB || ancestryA.length - ancestryB.length;
  	}

  	// if mutual ancestor is a section, we first test to see which section
  	// fragment comes first
  	if (fragments = mutualAncestor.fragments) {
  		indexA = fragments.indexOf(fragmentA);
  		indexB = fragments.indexOf(fragmentB);

  		return indexA - indexB || ancestryA.length - ancestryB.length;
  	}

  	throw new Error("An unexpected condition was met while comparing the position of two components. Please file an issue at https://github.com/RactiveJS/Ractive/issues - thanks!");
  };

  function getParent(item) {
  	var parentFragment;

  	if (parentFragment = item.parentFragment) {
  		return parentFragment.owner;
  	}

  	if (item.component && (parentFragment = item.component.parentFragment)) {
  		return parentFragment.owner;
  	}
  }

  function getAncestry(item) {
  	var ancestry, ancestor;

  	ancestry = [item];

  	ancestor = getParent(item);

  	while (ancestor) {
  		ancestry.push(ancestor);
  		ancestor = getParent(ancestor);
  	}

  	return ancestry;
  }

  var sortByDocumentPosition = function (node, otherNode) {
  	var bitmask;

  	if (node.compareDocumentPosition) {
  		bitmask = node.compareDocumentPosition(otherNode);
  		return bitmask & 2 ? 1 : -1;
  	}

  	// In old IE, we can piggy back on the mechanism for
  	// comparing component positions
  	return sortByItemPosition(node, otherNode);
  };

  var sort = function () {
  	this.sort(this._isComponentQuery ? sortByItemPosition : sortByDocumentPosition);
  	this._dirty = false;
  };

  var makeQuery_dirty = function () {
  	var _this = this;

  	if (!this._dirty) {
  		this._dirty = true;

  		// Once the DOM has been updated, ensure the query
  		// is correctly ordered
  		global_runloop.scheduleTask(function () {
  			_this._sort();
  		});
  	}
  };

  var remove = function (nodeOrComponent) {
  	var index = this.indexOf(this._isComponentQuery ? nodeOrComponent.instance : nodeOrComponent);

  	if (index !== -1) {
  		this.splice(index, 1);
  	}
  };

  var _makeQuery = makeQuery;
  function makeQuery(ractive, selector, live, isComponentQuery) {
  	var query = [];

  	defineProperties(query, {
  		selector: { value: selector },
  		live: { value: live },

  		_isComponentQuery: { value: isComponentQuery },
  		_test: { value: test }
  	});

  	if (!live) {
  		return query;
  	}

  	defineProperties(query, {
  		cancel: { value: makeQuery_cancel },

  		_root: { value: ractive },
  		_sort: { value: sort },
  		_makeDirty: { value: makeQuery_dirty },
  		_remove: { value: remove },

  		_dirty: { value: false, writable: true }
  	});

  	return query;
  }

  var prototype_findAll = Ractive$findAll;
  function Ractive$findAll(selector, options) {
  	var liveQueries, query;

  	if (!this.el) {
  		return [];
  	}

  	options = options || {};
  	liveQueries = this._liveQueries;

  	// Shortcut: if we're maintaining a live query with this
  	// selector, we don't need to traverse the parallel DOM
  	if (query = liveQueries[selector]) {

  		// Either return the exact same query, or (if not live) a snapshot
  		return options && options.live ? query : query.slice();
  	}

  	query = _makeQuery(this, selector, !!options.live, false);

  	// Add this to the list of live queries Ractive needs to maintain,
  	// if applicable
  	if (query.live) {
  		liveQueries.push(selector);
  		liveQueries["_" + selector] = query;
  	}

  	this.fragment.findAll(selector, query);
  	return query;
  }

  var prototype_findAllComponents = Ractive$findAllComponents;
  function Ractive$findAllComponents(selector, options) {
  	var liveQueries, query;

  	options = options || {};
  	liveQueries = this._liveComponentQueries;

  	// Shortcut: if we're maintaining a live query with this
  	// selector, we don't need to traverse the parallel DOM
  	if (query = liveQueries[selector]) {

  		// Either return the exact same query, or (if not live) a snapshot
  		return options && options.live ? query : query.slice();
  	}

  	query = _makeQuery(this, selector, !!options.live, true);

  	// Add this to the list of live queries Ractive needs to maintain,
  	// if applicable
  	if (query.live) {
  		liveQueries.push(selector);
  		liveQueries["_" + selector] = query;
  	}

  	this.fragment.findAllComponents(selector, query);
  	return query;
  }

  var prototype_findComponent = Ractive$findComponent;

  function Ractive$findComponent(selector) {
  	return this.fragment.findComponent(selector);
  }

  var findContainer = Ractive$findContainer;

  function Ractive$findContainer(selector) {
  	if (this.container) {
  		if (this.container.component && this.container.component.name === selector) {
  			return this.container;
  		} else {
  			return this.container.findContainer(selector);
  		}
  	}

  	return null;
  }

  var findParent = Ractive$findParent;

  function Ractive$findParent(selector) {

  	if (this.parent) {
  		if (this.parent.component && this.parent.component.name === selector) {
  			return this.parent;
  		} else {
  			return this.parent.findParent(selector);
  		}
  	}

  	return null;
  }

  var eventStack = {
  	enqueue: function (ractive, event) {
  		if (ractive.event) {
  			ractive._eventQueue = ractive._eventQueue || [];
  			ractive._eventQueue.push(ractive.event);
  		}
  		ractive.event = event;
  	},
  	dequeue: function (ractive) {
  		if (ractive._eventQueue && ractive._eventQueue.length) {
  			ractive.event = ractive._eventQueue.pop();
  		} else {
  			delete ractive.event;
  		}
  	}
  };

  var shared_eventStack = eventStack;

  var shared_fireEvent = fireEvent;

  function fireEvent(ractive, eventName) {
  	var options = arguments[2] === undefined ? {} : arguments[2];

  	if (!eventName) {
  		return;
  	}

  	if (!options.event) {
  		options.event = {
  			name: eventName,
  			// until event not included as argument default
  			_noArg: true
  		};
  	} else {
  		options.event.name = eventName;
  	}

  	var eventNames = getKeypath(eventName).wildcardMatches();
  	fireEventAs(ractive, eventNames, options.event, options.args, true);
  }

  function fireEventAs(ractive, eventNames, event, args) {
  	var initialFire = arguments[4] === undefined ? false : arguments[4];

  	var subscribers,
  	    i,
  	    bubble = true;

  	shared_eventStack.enqueue(ractive, event);

  	for (i = eventNames.length; i >= 0; i--) {
  		subscribers = ractive._subs[eventNames[i]];

  		if (subscribers) {
  			bubble = notifySubscribers(ractive, subscribers, event, args) && bubble;
  		}
  	}

  	shared_eventStack.dequeue(ractive);

  	if (ractive.parent && bubble) {

  		if (initialFire && ractive.component) {
  			var fullName = ractive.component.name + "." + eventNames[eventNames.length - 1];
  			eventNames = getKeypath(fullName).wildcardMatches();

  			if (event) {
  				event.component = ractive;
  			}
  		}

  		fireEventAs(ractive.parent, eventNames, event, args);
  	}
  }

  function notifySubscribers(ractive, subscribers, event, args) {
  	var originalEvent = null,
  	    stopEvent = false;

  	if (event && !event._noArg) {
  		args = [event].concat(args);
  	}

  	// subscribers can be modified inflight, e.g. "once" functionality
  	// so we need to copy to make sure everyone gets called
  	subscribers = subscribers.slice();

  	for (var i = 0, len = subscribers.length; i < len; i += 1) {
  		if (subscribers[i].apply(ractive, args) === false) {
  			stopEvent = true;
  		}
  	}

  	if (event && !event._noArg && stopEvent && (originalEvent = event.original)) {
  		originalEvent.preventDefault && originalEvent.preventDefault();
  		originalEvent.stopPropagation && originalEvent.stopPropagation();
  	}

  	return !stopEvent;
  }

  var prototype_fire = Ractive$fire;
  function Ractive$fire(eventName) {

  	var options = {
  		args: Array.prototype.slice.call(arguments, 1)
  	};

  	shared_fireEvent(this, eventName, options);
  }

  var prototype_get = Ractive$get;
  var options = {
  	capture: true, // top-level calls should be intercepted
  	noUnwrap: true, // wrapped values should NOT be unwrapped
  	fullRootGet: true // root get should return mappings
  };
  function Ractive$get(keypath) {
  	var value;

  	keypath = getKeypath(normalise(keypath));
  	value = this.viewmodel.get(keypath, options);

  	// Create inter-component binding, if necessary
  	if (value === undefined && this.parent && !this.isolated) {
  		if (shared_resolveRef(this, keypath.str, this.component.parentFragment)) {
  			// creates binding as side-effect, if appropriate
  			value = this.viewmodel.get(keypath);
  		}
  	}

  	return value;
  }

  var insert = Ractive$insert;

  var insertHook = new hooks_Hook("insert");
  function Ractive$insert(target, anchor) {
  	if (!this.fragment.rendered) {
  		// TODO create, and link to, documentation explaining this
  		throw new Error("The API has changed - you must call `ractive.render(target[, anchor])` to render your Ractive instance. Once rendered you can use `ractive.insert()`.");
  	}

  	target = getElement(target);
  	anchor = getElement(anchor) || null;

  	if (!target) {
  		throw new Error("You must specify a valid target to insert into");
  	}

  	target.insertBefore(this.detach(), anchor);
  	this.el = target;

  	(target.__ractive_instances__ || (target.__ractive_instances__ = [])).push(this);
  	this.detached = null;

  	fireInsertHook(this);
  }

  function fireInsertHook(ractive) {
  	insertHook.fire(ractive);

  	ractive.findAllComponents("*").forEach(function (child) {
  		fireInsertHook(child.instance);
  	});
  }

  var prototype_merge = Ractive$merge;
  function Ractive$merge(keypath, array, options) {
  	var currentArray, promise;

  	keypath = getKeypath(normalise(keypath));
  	currentArray = this.viewmodel.get(keypath);

  	// If either the existing value or the new value isn't an
  	// array, just do a regular set
  	if (!isArray(currentArray) || !isArray(array)) {
  		return this.set(keypath, array, options && options.complete);
  	}

  	// Manage transitions
  	promise = global_runloop.start(this, true);
  	this.viewmodel.merge(keypath, currentArray, array, options);
  	global_runloop.end();

  	return promise;
  }

  var Observer = function (ractive, keypath, callback, options) {
  	this.root = ractive;
  	this.keypath = keypath;
  	this.callback = callback;
  	this.defer = options.defer;

  	// default to root as context, but allow it to be overridden
  	this.context = options && options.context ? options.context : ractive;
  };

  Observer.prototype = {
  	init: function (immediate) {
  		this.value = this.root.get(this.keypath.str);

  		if (immediate !== false) {
  			this.update();
  		} else {
  			this.oldValue = this.value;
  		}
  	},

  	setValue: function (value) {
  		var _this = this;

  		if (!isEqual(value, this.value)) {
  			this.value = value;

  			if (this.defer && this.ready) {
  				global_runloop.scheduleTask(function () {
  					return _this.update();
  				});
  			} else {
  				this.update();
  			}
  		}
  	},

  	update: function () {
  		// Prevent infinite loops
  		if (this.updating) {
  			return;
  		}

  		this.updating = true;

  		this.callback.call(this.context, this.value, this.oldValue, this.keypath.str);
  		this.oldValue = this.value;

  		this.updating = false;
  	}
  };

  var observe_Observer = Observer;

  var observe_getPattern = getPattern;
  function getPattern(ractive, pattern) {
  	var matchingKeypaths, values;

  	matchingKeypaths = getMatchingKeypaths(ractive, pattern);

  	values = {};
  	matchingKeypaths.forEach(function (keypath) {
  		values[keypath.str] = ractive.get(keypath.str);
  	});

  	return values;
  }

  var PatternObserver,
      slice = Array.prototype.slice;

  PatternObserver = function (ractive, keypath, callback, options) {
  	this.root = ractive;

  	this.callback = callback;
  	this.defer = options.defer;

  	this.keypath = keypath;
  	this.regex = new RegExp("^" + keypath.str.replace(/\./g, "\\.").replace(/\*/g, "([^\\.]+)") + "$");
  	this.values = {};

  	if (this.defer) {
  		this.proxies = [];
  	}

  	// default to root as context, but allow it to be overridden
  	this.context = options && options.context ? options.context : ractive;
  };

  PatternObserver.prototype = {
  	init: function (immediate) {
  		var values, keypath;

  		values = observe_getPattern(this.root, this.keypath);

  		if (immediate !== false) {
  			for (keypath in values) {
  				if (values.hasOwnProperty(keypath)) {
  					this.update(getKeypath(keypath));
  				}
  			}
  		} else {
  			this.values = values;
  		}
  	},

  	update: function (keypath) {
  		var _this = this;

  		var values;

  		if (keypath.isPattern) {
  			values = observe_getPattern(this.root, keypath);

  			for (keypath in values) {
  				if (values.hasOwnProperty(keypath)) {
  					this.update(getKeypath(keypath));
  				}
  			}

  			return;
  		}

  		// special case - array mutation should not trigger `array.*`
  		// pattern observer with `array.length`
  		if (this.root.viewmodel.implicitChanges[keypath.str]) {
  			return;
  		}

  		if (this.defer && this.ready) {
  			global_runloop.scheduleTask(function () {
  				return _this.getProxy(keypath).update();
  			});
  			return;
  		}

  		this.reallyUpdate(keypath);
  	},

  	reallyUpdate: function (keypath) {
  		var keypathStr, value, keys, args;

  		keypathStr = keypath.str;
  		value = this.root.viewmodel.get(keypath);

  		// Prevent infinite loops
  		if (this.updating) {
  			this.values[keypathStr] = value;
  			return;
  		}

  		this.updating = true;

  		if (!isEqual(value, this.values[keypathStr]) || !this.ready) {
  			keys = slice.call(this.regex.exec(keypathStr), 1);
  			args = [value, this.values[keypathStr], keypathStr].concat(keys);

  			this.values[keypathStr] = value;
  			this.callback.apply(this.context, args);
  		}

  		this.updating = false;
  	},

  	getProxy: function (keypath) {
  		var _this = this;

  		if (!this.proxies[keypath.str]) {
  			this.proxies[keypath.str] = {
  				update: function () {
  					return _this.reallyUpdate(keypath);
  				}
  			};
  		}

  		return this.proxies[keypath.str];
  	}
  };

  var observe_PatternObserver = PatternObserver;

  var observe_getObserverFacade = getObserverFacade;
  var emptyObject = {};
  function getObserverFacade(ractive, keypath, callback, options) {
  	var observer, isPatternObserver, cancelled;

  	keypath = getKeypath(normalise(keypath));
  	options = options || emptyObject;

  	// pattern observers are treated differently
  	if (keypath.isPattern) {
  		observer = new observe_PatternObserver(ractive, keypath, callback, options);
  		ractive.viewmodel.patternObservers.push(observer);
  		isPatternObserver = true;
  	} else {
  		observer = new observe_Observer(ractive, keypath, callback, options);
  	}

  	observer.init(options.init);
  	ractive.viewmodel.register(keypath, observer, isPatternObserver ? "patternObservers" : "observers");

  	// This flag allows observers to initialise even with undefined values
  	observer.ready = true;

  	var facade = {
  		cancel: function () {
  			var index;

  			if (cancelled) {
  				return;
  			}

  			if (isPatternObserver) {
  				index = ractive.viewmodel.patternObservers.indexOf(observer);

  				ractive.viewmodel.patternObservers.splice(index, 1);
  				ractive.viewmodel.unregister(keypath, observer, "patternObservers");
  			} else {
  				ractive.viewmodel.unregister(keypath, observer, "observers");
  			}
  			cancelled = true;
  		}
  	};

  	ractive._observers.push(facade);
  	return facade;
  }

  var observe = Ractive$observe;
  function Ractive$observe(keypath, callback, options) {

  	var observers, map, keypaths, i;

  	// Allow a map of keypaths to handlers
  	if (isObject(keypath)) {
  		options = callback;
  		map = keypath;

  		observers = [];

  		for (keypath in map) {
  			if (map.hasOwnProperty(keypath)) {
  				callback = map[keypath];
  				observers.push(this.observe(keypath, callback, options));
  			}
  		}

  		return {
  			cancel: function () {
  				while (observers.length) {
  					observers.pop().cancel();
  				}
  			}
  		};
  	}

  	// Allow `ractive.observe( callback )` - i.e. observe entire model
  	if (typeof keypath === "function") {
  		options = callback;
  		callback = keypath;
  		keypath = "";

  		return observe_getObserverFacade(this, keypath, callback, options);
  	}

  	keypaths = keypath.split(" ");

  	// Single keypath
  	if (keypaths.length === 1) {
  		return observe_getObserverFacade(this, keypath, callback, options);
  	}

  	// Multiple space-separated keypaths
  	observers = [];

  	i = keypaths.length;
  	while (i--) {
  		keypath = keypaths[i];

  		if (keypath) {
  			observers.push(observe_getObserverFacade(this, keypath, callback, options));
  		}
  	}

  	return {
  		cancel: function () {
  			while (observers.length) {
  				observers.pop().cancel();
  			}
  		}
  	};
  }

  var observeOnce = Ractive$observeOnce;

  function Ractive$observeOnce(property, callback, options) {

  	var observer = this.observe(property, function () {
  		callback.apply(this, arguments);
  		observer.cancel();
  	}, { init: false, defer: options && options.defer });

  	return observer;
  }

  var shared_trim = function (str) {
    return str.trim();
  };

  var notEmptyString = function (str) {
    return str !== "";
  };

  var off = Ractive$off;
  function Ractive$off(eventName, callback) {
  	var _this = this;

  	var eventNames;

  	// if no arguments specified, remove all callbacks
  	if (!eventName) {
  		// TODO use this code instead, once the following issue has been resolved
  		// in PhantomJS (tests are unpassable otherwise!)
  		// https://github.com/ariya/phantomjs/issues/11856
  		// defineProperty( this, '_subs', { value: create( null ), configurable: true });
  		for (eventName in this._subs) {
  			delete this._subs[eventName];
  		}
  	} else {
  		// Handle multiple space-separated event names
  		eventNames = eventName.split(" ").map(shared_trim).filter(notEmptyString);

  		eventNames.forEach(function (eventName) {
  			var subscribers, index;

  			// If we have subscribers for this event...
  			if (subscribers = _this._subs[eventName]) {
  				// ...if a callback was specified, only remove that
  				if (callback) {
  					index = subscribers.indexOf(callback);
  					if (index !== -1) {
  						subscribers.splice(index, 1);
  					}
  				}

  				// ...otherwise remove all callbacks
  				else {
  					_this._subs[eventName] = [];
  				}
  			}
  		});
  	}

  	return this;
  }

  var on = Ractive$on;
  function Ractive$on(eventName, callback) {
  	var _this = this;

  	var listeners, n, eventNames;

  	// allow mutliple listeners to be bound in one go
  	if (typeof eventName === "object") {
  		listeners = [];

  		for (n in eventName) {
  			if (eventName.hasOwnProperty(n)) {
  				listeners.push(this.on(n, eventName[n]));
  			}
  		}

  		return {
  			cancel: function () {
  				var listener;

  				while (listener = listeners.pop()) {
  					listener.cancel();
  				}
  			}
  		};
  	}

  	// Handle multiple space-separated event names
  	eventNames = eventName.split(" ").map(shared_trim).filter(notEmptyString);

  	eventNames.forEach(function (eventName) {
  		(_this._subs[eventName] || (_this._subs[eventName] = [])).push(callback);
  	});

  	return {
  		cancel: function () {
  			return _this.off(eventName, callback);
  		}
  	};
  }

  var once = Ractive$once;

  function Ractive$once(eventName, handler) {

  	var listener = this.on(eventName, function () {
  		handler.apply(this, arguments);
  		listener.cancel();
  	});

  	// so we can still do listener.cancel() manually
  	return listener;
  }

  // This function takes an array, the name of a mutator method, and the
  // arguments to call that mutator method with, and returns an array that
  // maps the old indices to their new indices.

  // So if you had something like this...
  //
  //     array = [ 'a', 'b', 'c', 'd' ];
  //     array.push( 'e' );
  //
  // ...you'd get `[ 0, 1, 2, 3 ]` - in other words, none of the old indices
  // have changed. If you then did this...
  //
  //     array.unshift( 'z' );
  //
  // ...the indices would be `[ 1, 2, 3, 4, 5 ]` - every item has been moved
  // one higher to make room for the 'z'. If you removed an item, the new index
  // would be -1...
  //
  //     array.splice( 2, 2 );
  //
  // ...this would result in [ 0, 1, -1, -1, 2, 3 ].
  //
  // This information is used to enable fast, non-destructive shuffling of list
  // sections when you do e.g. `ractive.splice( 'items', 2, 2 );

  var shared_getNewIndices = getNewIndices;

  function getNewIndices(array, methodName, args) {
  	var spliceArguments,
  	    len,
  	    newIndices = [],
  	    removeStart,
  	    removeEnd,
  	    balance,
  	    i;

  	spliceArguments = getSpliceEquivalent(array, methodName, args);

  	if (!spliceArguments) {
  		return null; // TODO support reverse and sort?
  	}

  	len = array.length;
  	balance = spliceArguments.length - 2 - spliceArguments[1];

  	removeStart = Math.min(len, spliceArguments[0]);
  	removeEnd = removeStart + spliceArguments[1];

  	for (i = 0; i < removeStart; i += 1) {
  		newIndices.push(i);
  	}

  	for (; i < removeEnd; i += 1) {
  		newIndices.push(-1);
  	}

  	for (; i < len; i += 1) {
  		newIndices.push(i + balance);
  	}

  	// there is a net shift for the rest of the array starting with index + balance
  	if (balance !== 0) {
  		newIndices.touchedFrom = spliceArguments[0];
  	} else {
  		newIndices.touchedFrom = array.length;
  	}

  	return newIndices;
  }

  // The pop, push, shift an unshift methods can all be represented
  // as an equivalent splice
  function getSpliceEquivalent(array, methodName, args) {
  	switch (methodName) {
  		case "splice":
  			if (args[0] !== undefined && args[0] < 0) {
  				args[0] = array.length + Math.max(args[0], -array.length);
  			}

  			while (args.length < 2) {
  				args.push(0);
  			}

  			// ensure we only remove elements that exist
  			args[1] = Math.min(args[1], array.length - args[0]);

  			return args;

  		case "sort":
  		case "reverse":
  			return null;

  		case "pop":
  			if (array.length) {
  				return [array.length - 1, 1];
  			}
  			return [0, 0];

  		case "push":
  			return [array.length, 0].concat(args);

  		case "shift":
  			return [0, array.length ? 1 : 0];

  		case "unshift":
  			return [0, 0].concat(args);
  	}
  }

  var arrayProto = Array.prototype;

  var makeArrayMethod = function (methodName) {
  	return function (keypath) {
  		for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
  			args[_key - 1] = arguments[_key];
  		}

  		var array,
  		    newIndices = [],
  		    len,
  		    promise,
  		    result;

  		keypath = getKeypath(normalise(keypath));

  		array = this.viewmodel.get(keypath);
  		len = array.length;

  		if (!isArray(array)) {
  			throw new Error("Called ractive." + methodName + "('" + keypath.str + "'), but '" + keypath.str + "' does not refer to an array");
  		}

  		newIndices = shared_getNewIndices(array, methodName, args);

  		result = arrayProto[methodName].apply(array, args);
  		promise = global_runloop.start(this, true).then(function () {
  			return result;
  		});

  		if (!!newIndices) {
  			this.viewmodel.smartUpdate(keypath, array, newIndices);
  		} else {
  			this.viewmodel.mark(keypath);
  		}

  		global_runloop.end();

  		return promise;
  	};
  };

  var pop = makeArrayMethod("pop");

  var push = makeArrayMethod("push");

  var css,
      update,
      styleElement,
      head,
      styleSheet,
      inDom,
      global_css__prefix = "/* Ractive.js component styles */\n",
      styles = [],
      dirty = false;

  if (!isClient) {
  	// TODO handle encapsulated CSS in server-rendered HTML!
  	css = {
  		add: noop,
  		apply: noop
  	};
  } else {
  	styleElement = document.createElement("style");
  	styleElement.type = "text/css";

  	head = document.getElementsByTagName("head")[0];

  	inDom = false;

  	// Internet Exploder won't let you use styleSheet.innerHTML - we have to
  	// use styleSheet.cssText instead
  	styleSheet = styleElement.styleSheet;

  	update = function () {
  		var css = global_css__prefix + styles.map(function (s) {
  			return "\n/* {" + s.id + "} */\n" + s.styles;
  		}).join("\n");

  		if (styleSheet) {
  			styleSheet.cssText = css;
  		} else {
  			styleElement.innerHTML = css;
  		}

  		if (!inDom) {
  			head.appendChild(styleElement);
  			inDom = true;
  		}
  	};

  	css = {
  		add: function (s) {
  			styles.push(s);
  			dirty = true;
  		},

  		apply: function () {
  			if (dirty) {
  				update();
  				dirty = false;
  			}
  		}
  	};
  }

  var global_css = css;

  var prototype_render = Ractive$render;

  var renderHook = new hooks_Hook("render"),
      completeHook = new hooks_Hook("complete");
  function Ractive$render(target, anchor) {
  	var _this = this;

  	var promise, instances, transitionsEnabled;

  	// if `noIntro` is `true`, temporarily disable transitions
  	transitionsEnabled = this.transitionsEnabled;
  	if (this.noIntro) {
  		this.transitionsEnabled = false;
  	}

  	promise = global_runloop.start(this, true);
  	global_runloop.scheduleTask(function () {
  		return renderHook.fire(_this);
  	}, true);

  	if (this.fragment.rendered) {
  		throw new Error("You cannot call ractive.render() on an already rendered instance! Call ractive.unrender() first");
  	}

  	target = getElement(target) || this.el;
  	anchor = getElement(anchor) || this.anchor;

  	this.el = target;
  	this.anchor = anchor;

  	if (!this.append && target) {
  		// Teardown any existing instances *before* trying to set up the new one -
  		// avoids certain weird bugs
  		var others = target.__ractive_instances__;
  		if (others && others.length) {
  			removeOtherInstances(others);
  		}

  		// make sure we are the only occupants
  		target.innerHTML = ""; // TODO is this quicker than removeChild? Initial research inconclusive
  	}

  	if (this.cssId) {
  		// ensure encapsulated CSS is up-to-date
  		global_css.apply();
  	}

  	if (target) {
  		if (!(instances = target.__ractive_instances__)) {
  			target.__ractive_instances__ = [this];
  		} else {
  			instances.push(this);
  		}

  		if (anchor) {
  			target.insertBefore(this.fragment.render(), anchor);
  		} else {
  			target.appendChild(this.fragment.render());
  		}
  	}

  	global_runloop.end();

  	this.transitionsEnabled = transitionsEnabled;

  	return promise.then(function () {
  		return completeHook.fire(_this);
  	});
  }

  function removeOtherInstances(others) {
  	others.splice(0, others.length).forEach(teardown);
  }

  var adaptConfigurator = {
  	extend: function (Parent, proto, options) {
  		proto.adapt = custom_adapt__combine(proto.adapt, ensureArray(options.adapt));
  	},

  	init: function () {}
  };

  var custom_adapt = adaptConfigurator;

  function custom_adapt__combine(a, b) {
  	var c = a.slice(),
  	    i = b.length;

  	while (i--) {
  		if (! ~c.indexOf(b[i])) {
  			c.push(b[i]);
  		}
  	}

  	return c;
  }

  var transform = transformCss;

  var selectorsPattern = /(?:^|\})?\s*([^\{\}]+)\s*\{/g,
      commentsPattern = /\/\*.*?\*\//g,
      selectorUnitPattern = /((?:(?:\[[^\]+]\])|(?:[^\s\+\>\~:]))+)((?::[^\s\+\>\~\(]+(?:\([^\)]+\))?)?\s*[\s\+\>\~]?)\s*/g,
      mediaQueryPattern = /^@media/,
      dataRvcGuidPattern = /\[data-ractive-css~="\{[a-z0-9-]+\}"]/g;
  function transformCss(css, id) {
  	var transformed, dataAttr, addGuid;

  	dataAttr = "[data-ractive-css~=\"{" + id + "}\"]";

  	addGuid = function (selector) {
  		var selectorUnits,
  		    match,
  		    unit,
  		    base,
  		    prepended,
  		    appended,
  		    i,
  		    transformed = [];

  		selectorUnits = [];

  		while (match = selectorUnitPattern.exec(selector)) {
  			selectorUnits.push({
  				str: match[0],
  				base: match[1],
  				modifiers: match[2]
  			});
  		}

  		// For each simple selector within the selector, we need to create a version
  		// that a) combines with the id, and b) is inside the id
  		base = selectorUnits.map(extractString);

  		i = selectorUnits.length;
  		while (i--) {
  			appended = base.slice();

  			// Pseudo-selectors should go after the attribute selector
  			unit = selectorUnits[i];
  			appended[i] = unit.base + dataAttr + unit.modifiers || "";

  			prepended = base.slice();
  			prepended[i] = dataAttr + " " + prepended[i];

  			transformed.push(appended.join(" "), prepended.join(" "));
  		}

  		return transformed.join(", ");
  	};

  	if (dataRvcGuidPattern.test(css)) {
  		transformed = css.replace(dataRvcGuidPattern, dataAttr);
  	} else {
  		transformed = css.replace(commentsPattern, "").replace(selectorsPattern, function (match, $1) {
  			var selectors, transformed;

  			// don't transform media queries!
  			if (mediaQueryPattern.test($1)) return match;

  			selectors = $1.split(",").map(trim);
  			transformed = selectors.map(addGuid).join(", ") + " ";

  			return match.replace($1, transformed);
  		});
  	}

  	return transformed;
  }

  function trim(str) {
  	if (str.trim) {
  		return str.trim();
  	}

  	return str.replace(/^\s+/, "").replace(/\s+$/, "");
  }

  function extractString(unit) {
  	return unit.str;
  }

  var css_css__uid = 1;

  var cssConfigurator = {
  	name: "css",

  	extend: function (Parent, proto, options) {
  		if (options.css) {
  			var id = css_css__uid++;
  			var styles = options.noCssTransform ? options.css : transform(options.css, id);

  			proto.cssId = id;
  			global_css.add({ id: id, styles: styles });
  		}
  	},

  	init: function () {}
  };

  var css_css = cssConfigurator;

  function validate(data) {
  	// Warn if userOptions.data is a non-POJO
  	if (data && data.constructor !== Object) {
  		if (typeof data === "function") {} else if (typeof data !== "object") {
  			fatal("data option must be an object or a function, `" + data + "` is not valid");
  		} else {
  			warnIfDebug("If supplied, options.data should be a plain JavaScript object - using a non-POJO as the root object may work, but is discouraged");
  		}
  	}
  }

  var dataConfigurator = {
  	name: "data",

  	extend: function (Parent, proto, options) {
  		var key = undefined,
  		    value = undefined;

  		// check for non-primitives, which could cause mutation-related bugs
  		if (options.data && isObject(options.data)) {
  			for (key in options.data) {
  				value = options.data[key];

  				if (value && typeof value === "object") {
  					if (isObject(value) || isArray(value)) {
  						warnIfDebug("Passing a `data` option with object and array properties to Ractive.extend() is discouraged, as mutating them is likely to cause bugs. Consider using a data function instead:\n\n  // this...\n  data: function () {\n    return {\n      myObject: {}\n    };\n  })\n\n  // instead of this:\n  data: {\n    myObject: {}\n  }");
  					}
  				}
  			}
  		}

  		proto.data = custom_data__combine(proto.data, options.data);
  	},

  	init: function (Parent, ractive, options) {
  		var result = custom_data__combine(Parent.prototype.data, options.data);

  		if (typeof result === "function") {
  			result = result.call(ractive);
  		}

  		return result || {};
  	},

  	reset: function (ractive) {
  		var result = this.init(ractive.constructor, ractive, ractive.viewmodel);

  		ractive.viewmodel.reset(result);
  		return true;
  	}
  };

  var custom_data = dataConfigurator;

  function custom_data__combine(parentValue, childValue) {
  	validate(childValue);

  	var parentIsFn = typeof parentValue === "function";
  	var childIsFn = typeof childValue === "function";

  	// Very important, otherwise child instance can become
  	// the default data object on Ractive or a component.
  	// then ractive.set() ends up setting on the prototype!
  	if (!childValue && !parentIsFn) {
  		childValue = {};
  	}

  	// Fast path, where we just need to copy properties from
  	// parent to child
  	if (!parentIsFn && !childIsFn) {
  		return fromProperties(childValue, parentValue);
  	}

  	return function () {
  		var child = childIsFn ? callDataFunction(childValue, this) : childValue;
  		var parent = parentIsFn ? callDataFunction(parentValue, this) : parentValue;

  		return fromProperties(child, parent);
  	};
  }

  function callDataFunction(fn, context) {
  	var data = fn.call(context);

  	if (!data) return;

  	if (typeof data !== "object") {
  		fatal("Data function must return an object");
  	}

  	if (data.constructor !== Object) {
  		warnOnceIfDebug("Data function returned something other than a plain JavaScript object. This might work, but is strongly discouraged");
  	}

  	return data;
  }

  function fromProperties(primary, secondary) {
  	if (primary && secondary) {
  		for (var key in secondary) {
  			if (!(key in primary)) {
  				primary[key] = secondary[key];
  			}
  		}

  		return primary;
  	}

  	return primary || secondary;
  }

  // TODO do we need to support this in the new Ractive() case?

  var Parser,
      ParseError,
      parse_Parser__leadingWhitespace = /^\s+/;

  ParseError = function (message) {
  	this.name = "ParseError";
  	this.message = message;
  	try {
  		throw new Error(message);
  	} catch (e) {
  		this.stack = e.stack;
  	}
  };

  ParseError.prototype = Error.prototype;

  Parser = function (str, options) {
  	var items,
  	    item,
  	    lineStart = 0;

  	this.str = str;
  	this.options = options || {};
  	this.pos = 0;

  	this.lines = this.str.split("\n");
  	this.lineEnds = this.lines.map(function (line) {
  		var lineEnd = lineStart + line.length + 1; // +1 for the newline

  		lineStart = lineEnd;
  		return lineEnd;
  	}, 0);

  	// Custom init logic
  	if (this.init) this.init(str, options);

  	items = [];

  	while (this.pos < this.str.length && (item = this.read())) {
  		items.push(item);
  	}

  	this.leftover = this.remaining();
  	this.result = this.postProcess ? this.postProcess(items, options) : items;
  };

  Parser.prototype = {
  	read: function (converters) {
  		var pos, i, len, item;

  		if (!converters) converters = this.converters;

  		pos = this.pos;

  		len = converters.length;
  		for (i = 0; i < len; i += 1) {
  			this.pos = pos; // reset for each attempt

  			if (item = converters[i](this)) {
  				return item;
  			}
  		}

  		return null;
  	},

  	getLinePos: function (char) {
  		var lineNum = 0,
  		    lineStart = 0,
  		    columnNum;

  		while (char >= this.lineEnds[lineNum]) {
  			lineStart = this.lineEnds[lineNum];
  			lineNum += 1;
  		}

  		columnNum = char - lineStart;
  		return [lineNum + 1, columnNum + 1, char]; // line/col should be one-based, not zero-based!
  	},

  	error: function (message) {
  		var pos = this.getLinePos(this.pos);
  		var lineNum = pos[0];
  		var columnNum = pos[1];

  		var line = this.lines[pos[0] - 1];
  		var numTabs = 0;
  		var annotation = line.replace(/\t/g, function (match, char) {
  			if (char < pos[1]) {
  				numTabs += 1;
  			}

  			return "  ";
  		}) + "\n" + new Array(pos[1] + numTabs).join(" ") + "^----";

  		var error = new ParseError("" + message + " at line " + lineNum + " character " + columnNum + ":\n" + annotation);

  		error.line = pos[0];
  		error.character = pos[1];
  		error.shortMessage = message;

  		throw error;
  	},

  	matchString: function (string) {
  		if (this.str.substr(this.pos, string.length) === string) {
  			this.pos += string.length;
  			return string;
  		}
  	},

  	matchPattern: function (pattern) {
  		var match;

  		if (match = pattern.exec(this.remaining())) {
  			this.pos += match[0].length;
  			return match[1] || match[0];
  		}
  	},

  	allowWhitespace: function () {
  		this.matchPattern(parse_Parser__leadingWhitespace);
  	},

  	remaining: function () {
  		return this.str.substring(this.pos);
  	},

  	nextChar: function () {
  		return this.str.charAt(this.pos);
  	}
  };

  Parser.extend = function (proto) {
  	var Parent = this,
  	    Child,
  	    key;

  	Child = function (str, options) {
  		Parser.call(this, str, options);
  	};

  	Child.prototype = create(Parent.prototype);

  	for (key in proto) {
  		if (hasOwn.call(proto, key)) {
  			Child.prototype[key] = proto[key];
  		}
  	}

  	Child.extend = Parser.extend;
  	return Child;
  };

  var parse_Parser = Parser;

  var TEXT = 1;
  var INTERPOLATOR = 2;
  var TRIPLE = 3;
  var SECTION = 4;
  var INVERTED = 5;
  var CLOSING = 6;
  var ELEMENT = 7;
  var PARTIAL = 8;
  var COMMENT = 9;
  var DELIMCHANGE = 10;
  var ATTRIBUTE = 13;
  var CLOSING_TAG = 14;
  var COMPONENT = 15;
  var YIELDER = 16;
  var INLINE_PARTIAL = 17;
  var DOCTYPE = 18;

  var NUMBER_LITERAL = 20;
  var STRING_LITERAL = 21;
  var ARRAY_LITERAL = 22;
  var OBJECT_LITERAL = 23;
  var BOOLEAN_LITERAL = 24;
  var REGEXP_LITERAL = 25;

  var GLOBAL = 26;
  var KEY_VALUE_PAIR = 27;

  var REFERENCE = 30;
  var REFINEMENT = 31;
  var MEMBER = 32;
  var PREFIX_OPERATOR = 33;
  var BRACKETED = 34;
  var CONDITIONAL = 35;
  var INFIX_OPERATOR = 36;

  var INVOCATION = 40;

  var SECTION_IF = 50;
  var SECTION_UNLESS = 51;
  var SECTION_EACH = 52;
  var SECTION_WITH = 53;
  var SECTION_IF_WITH = 54;

  var ELSE = 60;
  var ELSEIF = 61;

  var mustache_readDelimiterChange = readDelimiterChange;
  var delimiterChangePattern = /^[^\s=]+/,
      whitespacePattern = /^\s+/;
  function readDelimiterChange(parser) {
  	var start, opening, closing;

  	if (!parser.matchString("=")) {
  		return null;
  	}

  	start = parser.pos;

  	// allow whitespace before new opening delimiter
  	parser.allowWhitespace();

  	opening = parser.matchPattern(delimiterChangePattern);
  	if (!opening) {
  		parser.pos = start;
  		return null;
  	}

  	// allow whitespace (in fact, it's necessary...)
  	if (!parser.matchPattern(whitespacePattern)) {
  		return null;
  	}

  	closing = parser.matchPattern(delimiterChangePattern);
  	if (!closing) {
  		parser.pos = start;
  		return null;
  	}

  	// allow whitespace before closing '='
  	parser.allowWhitespace();

  	if (!parser.matchString("=")) {
  		parser.pos = start;
  		return null;
  	}

  	return [opening, closing];
  }

  var readRegexpLiteral = readRegexpLiteral__readNumberLiteral;
  var regexpPattern = /^(\/(?:[^\n\r\u2028\u2029/\\[]|\\.|\[(?:[^\n\r\u2028\u2029\]\\]|\\.)*])+\/(?:([gimuy])(?![a-z]*\2))*(?![a-zA-Z_$0-9]))/;
  function readRegexpLiteral__readNumberLiteral(parser) {
  	var result;

  	if (result = parser.matchPattern(regexpPattern)) {
  		return {
  			t: REGEXP_LITERAL,
  			v: result
  		};
  	}

  	return null;
  }

  var converters_readMustache = readMustache;

  var delimiterChangeToken = { t: DELIMCHANGE, exclude: true };
  function readMustache(parser) {
  	var mustache, i;

  	// If we're inside a <script> or <style> tag, and we're not
  	// interpolating, bug out
  	if (parser.interpolate[parser.inside] === false) {
  		return null;
  	}

  	for (i = 0; i < parser.tags.length; i += 1) {
  		if (mustache = readMustacheOfType(parser, parser.tags[i])) {
  			return mustache;
  		}
  	}
  }

  function readMustacheOfType(parser, tag) {
  	var start, mustache, reader, i;

  	start = parser.pos;

  	if (parser.matchString("\\" + tag.open)) {
  		if (start === 0 || parser.str[start - 1] !== "\\") {
  			return tag.open;
  		}
  	} else if (!parser.matchString(tag.open)) {
  		return null;
  	}

  	// delimiter change?
  	if (mustache = mustache_readDelimiterChange(parser)) {
  		// find closing delimiter or abort...
  		if (!parser.matchString(tag.close)) {
  			return null;
  		}

  		// ...then make the switch
  		tag.open = mustache[0];
  		tag.close = mustache[1];
  		parser.sortMustacheTags();

  		return delimiterChangeToken;
  	}

  	parser.allowWhitespace();

  	// illegal section closer
  	if (parser.matchString("/")) {
  		parser.pos -= 1;
  		var rewind = parser.pos;
  		if (!readRegexpLiteral(parser)) {
  			parser.pos = rewind - tag.close.length;
  			parser.error("Attempted to close a section that wasn't open");
  		} else {
  			parser.pos = rewind;
  		}
  	}

  	for (i = 0; i < tag.readers.length; i += 1) {
  		reader = tag.readers[i];

  		if (mustache = reader(parser, tag)) {
  			if (tag.isStatic) {
  				mustache.s = true; // TODO make this `1` instead - more compact
  			}

  			if (parser.includeLinePositions) {
  				mustache.p = parser.getLinePos(start);
  			}

  			return mustache;
  		}
  	}

  	parser.pos = start;
  	return null;
  }

  var expectedExpression = "Expected a JavaScript expression";
  var expectedParen = "Expected closing paren";

  var literal_readNumberLiteral = literal_readNumberLiteral__readNumberLiteral;
  var literal_readNumberLiteral__numberPattern = /^(?:[+-]?)0*(?:(?:(?:[1-9]\d*)?\.\d+)|(?:(?:0|[1-9]\d*)\.)|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?/;
  function literal_readNumberLiteral__readNumberLiteral(parser) {
  	var result;

  	if (result = parser.matchPattern(literal_readNumberLiteral__numberPattern)) {
  		return {
  			t: NUMBER_LITERAL,
  			v: result
  		};
  	}

  	return null;
  }

  var literal_readBooleanLiteral = readBooleanLiteral;
  function readBooleanLiteral(parser) {
  	var remaining = parser.remaining();

  	if (remaining.substr(0, 4) === "true") {
  		parser.pos += 4;
  		return {
  			t: BOOLEAN_LITERAL,
  			v: "true"
  		};
  	}

  	if (remaining.substr(0, 5) === "false") {
  		parser.pos += 5;
  		return {
  			t: BOOLEAN_LITERAL,
  			v: "false"
  		};
  	}

  	return null;
  }

  var stringMiddlePattern, escapeSequencePattern, lineContinuationPattern;

  // Match one or more characters until: ", ', \, or EOL/EOF.
  // EOL/EOF is written as (?!.) (meaning there's no non-newline char next).
  stringMiddlePattern = /^(?=.)[^"'\\]+?(?:(?!.)|(?=["'\\]))/;

  // Match one escape sequence, including the backslash.
  escapeSequencePattern = /^\\(?:['"\\bfnrt]|0(?![0-9])|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|(?=.)[^ux0-9])/;

  // Match one ES5 line continuation (backslash + line terminator).
  lineContinuationPattern = /^\\(?:\r\n|[\u000A\u000D\u2028\u2029])/;

  // Helper for defining getDoubleQuotedString and getSingleQuotedString.
  var makeQuotedStringMatcher = function (okQuote) {
  	return function (parser) {
  		var start, literal, done, next;

  		start = parser.pos;
  		literal = "\"";
  		done = false;

  		while (!done) {
  			next = parser.matchPattern(stringMiddlePattern) || parser.matchPattern(escapeSequencePattern) || parser.matchString(okQuote);
  			if (next) {
  				if (next === "\"") {
  					literal += "\\\"";
  				} else if (next === "\\'") {
  					literal += "'";
  				} else {
  					literal += next;
  				}
  			} else {
  				next = parser.matchPattern(lineContinuationPattern);
  				if (next) {
  					// convert \(newline-like) into a \u escape, which is allowed in JSON
  					literal += "\\u" + ("000" + next.charCodeAt(1).toString(16)).slice(-4);
  				} else {
  					done = true;
  				}
  			}
  		}

  		literal += "\"";

  		// use JSON.parse to interpret escapes
  		return JSON.parse(literal);
  	};
  };

  var getSingleQuotedString = makeQuotedStringMatcher("\"");
  var getDoubleQuotedString = makeQuotedStringMatcher("'");

  var readStringLiteral = function (parser) {
  	var start, string;

  	start = parser.pos;

  	if (parser.matchString("\"")) {
  		string = getDoubleQuotedString(parser);

  		if (!parser.matchString("\"")) {
  			parser.pos = start;
  			return null;
  		}

  		return {
  			t: STRING_LITERAL,
  			v: string
  		};
  	}

  	if (parser.matchString("'")) {
  		string = getSingleQuotedString(parser);

  		if (!parser.matchString("'")) {
  			parser.pos = start;
  			return null;
  		}

  		return {
  			t: STRING_LITERAL,
  			v: string
  		};
  	}

  	return null;
  };

  var patterns__name = /^[a-zA-Z_$][a-zA-Z_$0-9]*/;

  // http://mathiasbynens.be/notes/javascript-properties
  // can be any name, string literal, or number literal
  var shared_readKey = readKey;
  var identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
  function readKey(parser) {
  	var token;

  	if (token = readStringLiteral(parser)) {
  		return identifier.test(token.v) ? token.v : "\"" + token.v.replace(/"/g, "\\\"") + "\"";
  	}

  	if (token = literal_readNumberLiteral(parser)) {
  		return token.v;
  	}

  	if (token = parser.matchPattern(patterns__name)) {
  		return token;
  	}
  }

  var keyValuePair = readKeyValuePair;
  function readKeyValuePair(parser) {
  	var start, key, value;

  	start = parser.pos;

  	// allow whitespace between '{' and key
  	parser.allowWhitespace();

  	key = shared_readKey(parser);
  	if (key === null) {
  		parser.pos = start;
  		return null;
  	}

  	// allow whitespace between key and ':'
  	parser.allowWhitespace();

  	// next character must be ':'
  	if (!parser.matchString(":")) {
  		parser.pos = start;
  		return null;
  	}

  	// allow whitespace between ':' and value
  	parser.allowWhitespace();

  	// next expression must be a, well... expression
  	value = converters_readExpression(parser);
  	if (value === null) {
  		parser.pos = start;
  		return null;
  	}

  	return {
  		t: KEY_VALUE_PAIR,
  		k: key,
  		v: value
  	};
  }

  var objectLiteral_keyValuePairs = readKeyValuePairs;
  function readKeyValuePairs(parser) {
  	var start, pairs, pair, keyValuePairs;

  	start = parser.pos;

  	pair = keyValuePair(parser);
  	if (pair === null) {
  		return null;
  	}

  	pairs = [pair];

  	if (parser.matchString(",")) {
  		keyValuePairs = readKeyValuePairs(parser);

  		if (!keyValuePairs) {
  			parser.pos = start;
  			return null;
  		}

  		return pairs.concat(keyValuePairs);
  	}

  	return pairs;
  }

  var readObjectLiteral = function (parser) {
  	var start, keyValuePairs;

  	start = parser.pos;

  	// allow whitespace
  	parser.allowWhitespace();

  	if (!parser.matchString("{")) {
  		parser.pos = start;
  		return null;
  	}

  	keyValuePairs = objectLiteral_keyValuePairs(parser);

  	// allow whitespace between final value and '}'
  	parser.allowWhitespace();

  	if (!parser.matchString("}")) {
  		parser.pos = start;
  		return null;
  	}

  	return {
  		t: OBJECT_LITERAL,
  		m: keyValuePairs
  	};
  };

  var shared_readExpressionList = readExpressionList;
  function readExpressionList(parser) {
  	var start, expressions, expr, next;

  	start = parser.pos;

  	parser.allowWhitespace();

  	expr = converters_readExpression(parser);

  	if (expr === null) {
  		return null;
  	}

  	expressions = [expr];

  	// allow whitespace between expression and ','
  	parser.allowWhitespace();

  	if (parser.matchString(",")) {
  		next = readExpressionList(parser);
  		if (next === null) {
  			parser.error(expectedExpression);
  		}

  		next.forEach(append);
  	}

  	function append(expression) {
  		expressions.push(expression);
  	}

  	return expressions;
  }

  var readArrayLiteral = function (parser) {
  	var start, expressionList;

  	start = parser.pos;

  	// allow whitespace before '['
  	parser.allowWhitespace();

  	if (!parser.matchString("[")) {
  		parser.pos = start;
  		return null;
  	}

  	expressionList = shared_readExpressionList(parser);

  	if (!parser.matchString("]")) {
  		parser.pos = start;
  		return null;
  	}

  	return {
  		t: ARRAY_LITERAL,
  		m: expressionList
  	};
  };

  var primary_readLiteral = readLiteral;
  function readLiteral(parser) {
  	return literal_readNumberLiteral(parser) || literal_readBooleanLiteral(parser) || readStringLiteral(parser) || readObjectLiteral(parser) || readArrayLiteral(parser) || readRegexpLiteral(parser);
  }

  var primary_readReference = readReference;
  var prefixPattern = /^(?:~\/|(?:\.\.\/)+|\.\/(?:\.\.\/)*|\.)/,
      globals,
      keywords;

  // if a reference is a browser global, we don't deference it later, so it needs special treatment
  globals = /^(?:Array|console|Date|RegExp|decodeURIComponent|decodeURI|encodeURIComponent|encodeURI|isFinite|isNaN|parseFloat|parseInt|JSON|Math|NaN|undefined|null)\b/;

  // keywords are not valid references, with the exception of `this`
  keywords = /^(?:break|case|catch|continue|debugger|default|delete|do|else|finally|for|function|if|in|instanceof|new|return|switch|throw|try|typeof|var|void|while|with)$/;

  var legalReference = /^[a-zA-Z$_0-9]+(?:(?:\.[a-zA-Z$_0-9]+)|(?:\[[0-9]+\]))*/;
  var relaxedName = /^[a-zA-Z_$][-a-zA-Z_$0-9]*/;
  function readReference(parser) {
  	var startPos, prefix, name, global, reference, lastDotIndex;

  	startPos = parser.pos;

  	name = parser.matchPattern(/^@(?:keypath|index|key)/);

  	if (!name) {
  		prefix = parser.matchPattern(prefixPattern) || "";
  		name = !prefix && parser.relaxedNames && parser.matchPattern(relaxedName) || parser.matchPattern(legalReference);

  		if (!name && prefix === ".") {
  			prefix = "";
  			name = ".";
  		}
  	}

  	if (!name) {
  		return null;
  	}

  	// bug out if it's a keyword (exception for ancestor/restricted refs - see https://github.com/ractivejs/ractive/issues/1497)
  	if (!prefix && !parser.relaxedNames && keywords.test(name)) {
  		parser.pos = startPos;
  		return null;
  	}

  	// if this is a browser global, stop here
  	if (!prefix && globals.test(name)) {
  		global = globals.exec(name)[0];
  		parser.pos = startPos + global.length;

  		return {
  			t: GLOBAL,
  			v: global
  		};
  	}

  	reference = (prefix || "") + normalise(name);

  	if (parser.matchString("(")) {
  		// if this is a method invocation (as opposed to a function) we need
  		// to strip the method name from the reference combo, else the context
  		// will be wrong
  		lastDotIndex = reference.lastIndexOf(".");
  		if (lastDotIndex !== -1) {
  			reference = reference.substr(0, lastDotIndex);
  			parser.pos = startPos + reference.length;
  		} else {
  			parser.pos -= 1;
  		}
  	}

  	return {
  		t: REFERENCE,
  		n: reference.replace(/^this\./, "./").replace(/^this$/, ".")
  	};
  }

  var primary_readBracketedExpression = readBracketedExpression;
  function readBracketedExpression(parser) {
  	var start, expr;

  	start = parser.pos;

  	if (!parser.matchString("(")) {
  		return null;
  	}

  	parser.allowWhitespace();

  	expr = converters_readExpression(parser);
  	if (!expr) {
  		parser.error(expectedExpression);
  	}

  	parser.allowWhitespace();

  	if (!parser.matchString(")")) {
  		parser.error(expectedParen);
  	}

  	return {
  		t: BRACKETED,
  		x: expr
  	};
  }

  var readPrimary = function (parser) {
  	return primary_readLiteral(parser) || primary_readReference(parser) || primary_readBracketedExpression(parser);
  };

  var shared_readRefinement = readRefinement;
  function readRefinement(parser) {
  	var start, name, expr;

  	start = parser.pos;

  	parser.allowWhitespace();

  	// "." name
  	if (parser.matchString(".")) {
  		parser.allowWhitespace();

  		if (name = parser.matchPattern(patterns__name)) {
  			return {
  				t: REFINEMENT,
  				n: name
  			};
  		}

  		parser.error("Expected a property name");
  	}

  	// "[" expression "]"
  	if (parser.matchString("[")) {
  		parser.allowWhitespace();

  		expr = converters_readExpression(parser);
  		if (!expr) {
  			parser.error(expectedExpression);
  		}

  		parser.allowWhitespace();

  		if (!parser.matchString("]")) {
  			parser.error("Expected ']'");
  		}

  		return {
  			t: REFINEMENT,
  			x: expr
  		};
  	}

  	return null;
  }

  var readMemberOrInvocation = function (parser) {
  	var current, expression, refinement, expressionList;

  	expression = readPrimary(parser);

  	if (!expression) {
  		return null;
  	}

  	while (expression) {
  		current = parser.pos;

  		if (refinement = shared_readRefinement(parser)) {
  			expression = {
  				t: MEMBER,
  				x: expression,
  				r: refinement
  			};
  		} else if (parser.matchString("(")) {
  			parser.allowWhitespace();
  			expressionList = shared_readExpressionList(parser);

  			parser.allowWhitespace();

  			if (!parser.matchString(")")) {
  				parser.error(expectedParen);
  			}

  			expression = {
  				t: INVOCATION,
  				x: expression
  			};

  			if (expressionList) {
  				expression.o = expressionList;
  			}
  		} else {
  			break;
  		}
  	}

  	return expression;
  };

  var readTypeOf, makePrefixSequenceMatcher;

  makePrefixSequenceMatcher = function (symbol, fallthrough) {
  	return function (parser) {
  		var expression;

  		if (expression = fallthrough(parser)) {
  			return expression;
  		}

  		if (!parser.matchString(symbol)) {
  			return null;
  		}

  		parser.allowWhitespace();

  		expression = converters_readExpression(parser);
  		if (!expression) {
  			parser.error(expectedExpression);
  		}

  		return {
  			s: symbol,
  			o: expression,
  			t: PREFIX_OPERATOR
  		};
  	};
  };

  // create all prefix sequence matchers, return readTypeOf
  (function () {
  	var i, len, matcher, prefixOperators, fallthrough;

  	prefixOperators = "! ~ + - typeof".split(" ");

  	fallthrough = readMemberOrInvocation;
  	for (i = 0, len = prefixOperators.length; i < len; i += 1) {
  		matcher = makePrefixSequenceMatcher(prefixOperators[i], fallthrough);
  		fallthrough = matcher;
  	}

  	// typeof operator is higher precedence than multiplication, so provides the
  	// fallthrough for the multiplication sequence matcher we're about to create
  	// (we're skipping void and delete)
  	readTypeOf = fallthrough;
  })();

  var readTypeof = readTypeOf;

  var readLogicalOr, makeInfixSequenceMatcher;

  makeInfixSequenceMatcher = function (symbol, fallthrough) {
  	return function (parser) {
  		var start, left, right;

  		left = fallthrough(parser);
  		if (!left) {
  			return null;
  		}

  		// Loop to handle left-recursion in a case like `a * b * c` and produce
  		// left association, i.e. `(a * b) * c`.  The matcher can't call itself
  		// to parse `left` because that would be infinite regress.
  		while (true) {
  			start = parser.pos;

  			parser.allowWhitespace();

  			if (!parser.matchString(symbol)) {
  				parser.pos = start;
  				return left;
  			}

  			// special case - in operator must not be followed by [a-zA-Z_$0-9]
  			if (symbol === "in" && /[a-zA-Z_$0-9]/.test(parser.remaining().charAt(0))) {
  				parser.pos = start;
  				return left;
  			}

  			parser.allowWhitespace();

  			// right operand must also consist of only higher-precedence operators
  			right = fallthrough(parser);
  			if (!right) {
  				parser.pos = start;
  				return left;
  			}

  			left = {
  				t: INFIX_OPERATOR,
  				s: symbol,
  				o: [left, right]
  			};

  			// Loop back around.  If we don't see another occurrence of the symbol,
  			// we'll return left.
  		}
  	};
  };

  // create all infix sequence matchers, and return readLogicalOr
  (function () {
  	var i, len, matcher, infixOperators, fallthrough;

  	// All the infix operators on order of precedence (source: https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Operators/Operator_Precedence)
  	// Each sequence matcher will initially fall through to its higher precedence
  	// neighbour, and only attempt to match if one of the higher precedence operators
  	// (or, ultimately, a literal, reference, or bracketed expression) already matched
  	infixOperators = "* / % + - << >> >>> < <= > >= in instanceof == != === !== & ^ | && ||".split(" ");

  	// A typeof operator is higher precedence than multiplication
  	fallthrough = readTypeof;
  	for (i = 0, len = infixOperators.length; i < len; i += 1) {
  		matcher = makeInfixSequenceMatcher(infixOperators[i], fallthrough);
  		fallthrough = matcher;
  	}

  	// Logical OR is the fallthrough for the conditional matcher
  	readLogicalOr = fallthrough;
  })();

  var expressions_readLogicalOr = readLogicalOr;

  // The conditional operator is the lowest precedence operator, so we start here
  var readConditional = getConditional;
  function getConditional(parser) {
  	var start, expression, ifTrue, ifFalse;

  	expression = expressions_readLogicalOr(parser);
  	if (!expression) {
  		return null;
  	}

  	start = parser.pos;

  	parser.allowWhitespace();

  	if (!parser.matchString("?")) {
  		parser.pos = start;
  		return expression;
  	}

  	parser.allowWhitespace();

  	ifTrue = converters_readExpression(parser);
  	if (!ifTrue) {
  		parser.error(expectedExpression);
  	}

  	parser.allowWhitespace();

  	if (!parser.matchString(":")) {
  		parser.error("Expected \":\"");
  	}

  	parser.allowWhitespace();

  	ifFalse = converters_readExpression(parser);
  	if (!ifFalse) {
  		parser.error(expectedExpression);
  	}

  	return {
  		t: CONDITIONAL,
  		o: [expression, ifTrue, ifFalse]
  	};
  }

  var converters_readExpression = readExpression;
  function readExpression(parser) {
  	// The conditional operator is the lowest precedence operator (except yield,
  	// assignment operators, and commas, none of which are supported), so we
  	// start there. If it doesn't match, it 'falls through' to progressively
  	// higher precedence operators, until it eventually matches (or fails to
  	// match) a 'primary' - a literal or a reference. This way, the abstract syntax
  	// tree has everything in its proper place, i.e. 2 + 3 * 4 === 14, not 20.
  	return readConditional(parser);
  }

  var utils_flattenExpression = flattenExpression;

  function flattenExpression(expression) {
  	var refs;

  	extractRefs(expression, refs = []);

  	return {
  		r: refs,
  		s: stringify(expression)
  	};

  	function stringify(node) {
  		switch (node.t) {
  			case BOOLEAN_LITERAL:
  			case GLOBAL:
  			case NUMBER_LITERAL:
  			case REGEXP_LITERAL:
  				return node.v;

  			case STRING_LITERAL:
  				return JSON.stringify(String(node.v));

  			case ARRAY_LITERAL:
  				return "[" + (node.m ? node.m.map(stringify).join(",") : "") + "]";

  			case OBJECT_LITERAL:
  				return "{" + (node.m ? node.m.map(stringify).join(",") : "") + "}";

  			case KEY_VALUE_PAIR:
  				return node.k + ":" + stringify(node.v);

  			case PREFIX_OPERATOR:
  				return (node.s === "typeof" ? "typeof " : node.s) + stringify(node.o);

  			case INFIX_OPERATOR:
  				return stringify(node.o[0]) + (node.s.substr(0, 2) === "in" ? " " + node.s + " " : node.s) + stringify(node.o[1]);

  			case INVOCATION:
  				return stringify(node.x) + "(" + (node.o ? node.o.map(stringify).join(",") : "") + ")";

  			case BRACKETED:
  				return "(" + stringify(node.x) + ")";

  			case MEMBER:
  				return stringify(node.x) + stringify(node.r);

  			case REFINEMENT:
  				return node.n ? "." + node.n : "[" + stringify(node.x) + "]";

  			case CONDITIONAL:
  				return stringify(node.o[0]) + "?" + stringify(node.o[1]) + ":" + stringify(node.o[2]);

  			case REFERENCE:
  				return "_" + refs.indexOf(node.n);

  			default:
  				throw new Error("Expected legal JavaScript");
  		}
  	}
  }

  // TODO maybe refactor this?
  function extractRefs(node, refs) {
  	var i, list;

  	if (node.t === REFERENCE) {
  		if (refs.indexOf(node.n) === -1) {
  			refs.unshift(node.n);
  		}
  	}

  	list = node.o || node.m;
  	if (list) {
  		if (isObject(list)) {
  			extractRefs(list, refs);
  		} else {
  			i = list.length;
  			while (i--) {
  				extractRefs(list[i], refs);
  			}
  		}
  	}

  	if (node.x) {
  		extractRefs(node.x, refs);
  	}

  	if (node.r) {
  		extractRefs(node.r, refs);
  	}

  	if (node.v) {
  		extractRefs(node.v, refs);
  	}
  }

  var utils_refineExpression = refineExpression;

  var arrayMemberPattern = /^[0-9][1-9]*$/;
  function refineExpression(expression, mustache) {
  	var referenceExpression;

  	if (expression) {
  		while (expression.t === BRACKETED && expression.x) {
  			expression = expression.x;
  		}

  		// special case - integers should be treated as array members references,
  		// rather than as expressions in their own right
  		if (expression.t === REFERENCE) {
  			mustache.r = expression.n;
  		} else {
  			if (expression.t === NUMBER_LITERAL && arrayMemberPattern.test(expression.v)) {
  				mustache.r = expression.v;
  			} else if (referenceExpression = getReferenceExpression(expression)) {
  				mustache.rx = referenceExpression;
  			} else {
  				mustache.x = utils_flattenExpression(expression);
  			}
  		}

  		return mustache;
  	}
  }

  // TODO refactor this! it's bewildering
  function getReferenceExpression(expression) {
  	var members = [],
  	    refinement;

  	while (expression.t === MEMBER && expression.r.t === REFINEMENT) {
  		refinement = expression.r;

  		if (refinement.x) {
  			if (refinement.x.t === REFERENCE) {
  				members.unshift(refinement.x);
  			} else {
  				members.unshift(utils_flattenExpression(refinement.x));
  			}
  		} else {
  			members.unshift(refinement.n);
  		}

  		expression = expression.x;
  	}

  	if (expression.t !== REFERENCE) {
  		return null;
  	}

  	return {
  		r: expression.n,
  		m: members
  	};
  }

  var mustache_readTriple = readTriple;
  function readTriple(parser, tag) {
  	var expression = converters_readExpression(parser),
  	    triple;

  	if (!expression) {
  		return null;
  	}

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	triple = { t: TRIPLE };
  	utils_refineExpression(expression, triple); // TODO handle this differently - it's mysterious

  	return triple;
  }

  var mustache_readUnescaped = readUnescaped;
  function readUnescaped(parser, tag) {
  	var expression, triple;

  	if (!parser.matchString("&")) {
  		return null;
  	}

  	parser.allowWhitespace();

  	expression = converters_readExpression(parser);

  	if (!expression) {
  		return null;
  	}

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	triple = { t: TRIPLE };
  	utils_refineExpression(expression, triple); // TODO handle this differently - it's mysterious

  	return triple;
  }

  var mustache_readPartial = readPartial;
  function readPartial(parser, tag) {
  	var start, nameStart, expression, context, partial;

  	start = parser.pos;

  	if (!parser.matchString(">")) {
  		return null;
  	}

  	parser.allowWhitespace();
  	nameStart = parser.pos;

  	// Partial names can include hyphens, so we can't use readExpression
  	// blindly. Instead, we use the `relaxedNames` flag to indicate that
  	// `foo-bar` should be read as a single name, rather than 'subtract
  	// bar from foo'
  	parser.relaxedNames = true;
  	expression = converters_readExpression(parser);
  	parser.relaxedNames = false;

  	parser.allowWhitespace();
  	context = converters_readExpression(parser);
  	parser.allowWhitespace();

  	if (!expression) {
  		return null;
  	}

  	partial = { t: PARTIAL };
  	utils_refineExpression(expression, partial); // TODO...

  	parser.allowWhitespace();

  	// if we have another expression - e.g. `{{>foo bar}}` - then
  	// we turn it into `{{#with bar}}{{>foo}}{{/with}}`
  	if (context) {
  		partial = {
  			t: SECTION,
  			n: SECTION_WITH,
  			f: [partial]
  		};

  		utils_refineExpression(context, partial);
  	}

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	return partial;
  }

  var readMustacheComment = readComment;
  function readComment(parser, tag) {
  	var index;

  	if (!parser.matchString("!")) {
  		return null;
  	}

  	index = parser.remaining().indexOf(tag.close);

  	if (index !== -1) {
  		parser.pos += index + tag.close.length;
  		return { t: COMMENT };
  	}
  }

  var converters_readExpressionOrReference = readExpressionOrReference;
  function readExpressionOrReference(parser, expectedFollowers) {
  	var start, expression, i;

  	start = parser.pos;
  	expression = converters_readExpression(parser);

  	if (!expression) {
  		return null;
  	}

  	for (i = 0; i < expectedFollowers.length; i += 1) {
  		if (parser.remaining().substr(0, expectedFollowers[i].length) === expectedFollowers[i]) {
  			return expression;
  		}
  	}

  	parser.pos = start;
  	return primary_readReference(parser);
  }

  var mustache_readInterpolator = readInterpolator;
  function readInterpolator(parser, tag) {
  	var start, expression, interpolator, err;

  	start = parser.pos;

  	// TODO would be good for perf if we could do away with the try-catch
  	try {
  		expression = converters_readExpressionOrReference(parser, [tag.close]);
  	} catch (e) {
  		err = e;
  	}

  	if (!expression) {
  		if (parser.str.charAt(start) === "!") {
  			// special case - comment
  			parser.pos = start;
  			return null;
  		}

  		if (err) {
  			throw err;
  		}
  	}

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "' after reference");

  		if (!expression) {
  			// special case - comment
  			if (parser.nextChar() === "!") {
  				return null;
  			}

  			parser.error("Expected expression or legal reference");
  		}
  	}

  	interpolator = { t: INTERPOLATOR };
  	utils_refineExpression(expression, interpolator); // TODO handle this differently - it's mysterious

  	return interpolator;
  }

  var mustache_readYielder = readYielder;
  var yieldPattern = /^yield\s*/;
  function readYielder(parser, tag) {
  	var start, name, yielder;

  	if (!parser.matchPattern(yieldPattern)) {
  		return null;
  	}

  	start = parser.pos;
  	name = parser.matchPattern(/^[a-zA-Z_$][a-zA-Z_$0-9\-]*/);

  	parser.allowWhitespace();

  	if (!parser.matchString(tag.close)) {
  		parser.error("expected legal partial name");
  	}

  	yielder = { t: YIELDER };

  	if (name) {
  		yielder.n = name;
  	}

  	return yielder;
  }

  var section_readClosing = readClosing;
  function readClosing(parser, tag) {
  	var start, remaining, index, closing;

  	start = parser.pos;

  	if (!parser.matchString(tag.open)) {
  		return null;
  	}

  	parser.allowWhitespace();

  	if (!parser.matchString("/")) {
  		parser.pos = start;
  		return null;
  	}

  	parser.allowWhitespace();

  	remaining = parser.remaining();
  	index = remaining.indexOf(tag.close);

  	if (index !== -1) {
  		closing = {
  			t: CLOSING,
  			r: remaining.substr(0, index).split(" ")[0]
  		};

  		parser.pos += index;

  		if (!parser.matchString(tag.close)) {
  			parser.error("Expected closing delimiter '" + tag.close + "'");
  		}

  		return closing;
  	}

  	parser.pos = start;
  	return null;
  }

  var section_readElse = section_readElse__readElse;
  var section_readElse__elsePattern = /^\s*else\s*/;
  function section_readElse__readElse(parser, tag) {
  	var start = parser.pos;

  	if (!parser.matchString(tag.open)) {
  		return null;
  	}

  	if (!parser.matchPattern(section_readElse__elsePattern)) {
  		parser.pos = start;
  		return null;
  	}

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	return {
  		t: ELSE
  	};
  }

  var readElseIf = readElseIf__readElse;
  var readElseIf__elsePattern = /^\s*elseif\s+/;
  function readElseIf__readElse(parser, tag) {
  	var start = parser.pos,
  	    expression;

  	if (!parser.matchString(tag.open)) {
  		return null;
  	}

  	if (!parser.matchPattern(readElseIf__elsePattern)) {
  		parser.pos = start;
  		return null;
  	}

  	expression = converters_readExpression(parser);

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	return {
  		t: ELSEIF,
  		x: expression
  	};
  }

  var handlebarsBlockCodes = {
  	each: SECTION_EACH,
  	"if": SECTION_IF,
  	"if-with": SECTION_IF_WITH,
  	"with": SECTION_WITH,
  	unless: SECTION_UNLESS
  };

  var mustache_readSection = readSection;

  var indexRefPattern = /^\s*:\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/,
      keyIndexRefPattern = /^\s*,\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/,
      handlebarsBlockPattern = new RegExp("^(" + Object.keys(handlebarsBlockCodes).join("|") + ")\\b");
  function readSection(parser, tag) {
  	var start, expression, section, child, children, hasElse, block, unlessBlock, conditions, closed, i, expectedClose;

  	start = parser.pos;

  	if (parser.matchString("^")) {
  		section = { t: SECTION, f: [], n: SECTION_UNLESS };
  	} else if (parser.matchString("#")) {
  		section = { t: SECTION, f: [] };

  		if (parser.matchString("partial")) {
  			parser.pos = start - parser.standardDelimiters[0].length;
  			parser.error("Partial definitions can only be at the top level of the template, or immediately inside components");
  		}

  		if (block = parser.matchPattern(handlebarsBlockPattern)) {
  			expectedClose = block;
  			section.n = handlebarsBlockCodes[block];
  		}
  	} else {
  		return null;
  	}

  	parser.allowWhitespace();

  	expression = converters_readExpression(parser);

  	if (!expression) {
  		parser.error("Expected expression");
  	}

  	// optional index and key references
  	if (i = parser.matchPattern(indexRefPattern)) {
  		var extra = undefined;

  		if (extra = parser.matchPattern(keyIndexRefPattern)) {
  			section.i = i + "," + extra;
  		} else {
  			section.i = i;
  		}
  	}

  	parser.allowWhitespace();

  	if (!parser.matchString(tag.close)) {
  		parser.error("Expected closing delimiter '" + tag.close + "'");
  	}

  	parser.sectionDepth += 1;
  	children = section.f;

  	conditions = [];

  	do {
  		if (child = section_readClosing(parser, tag)) {
  			if (expectedClose && child.r !== expectedClose) {
  				parser.error("Expected " + tag.open + "/" + expectedClose + "" + tag.close);
  			}

  			parser.sectionDepth -= 1;
  			closed = true;
  		} else if (child = readElseIf(parser, tag)) {
  			if (section.n === SECTION_UNLESS) {
  				parser.error("{{else}} not allowed in {{#unless}}");
  			}

  			if (hasElse) {
  				parser.error("illegal {{elseif...}} after {{else}}");
  			}

  			if (!unlessBlock) {
  				unlessBlock = createUnlessBlock(expression, section.n);
  			}

  			unlessBlock.f.push({
  				t: SECTION,
  				n: SECTION_IF,
  				x: utils_flattenExpression(mustache_readSection__combine(conditions.concat(child.x))),
  				f: children = []
  			});

  			conditions.push(invert(child.x));
  		} else if (child = section_readElse(parser, tag)) {
  			if (section.n === SECTION_UNLESS) {
  				parser.error("{{else}} not allowed in {{#unless}}");
  			}

  			if (hasElse) {
  				parser.error("there can only be one {{else}} block, at the end of a section");
  			}

  			hasElse = true;

  			// use an unless block if there's no elseif
  			if (!unlessBlock) {
  				unlessBlock = createUnlessBlock(expression, section.n);
  				children = unlessBlock.f;
  			} else {
  				unlessBlock.f.push({
  					t: SECTION,
  					n: SECTION_IF,
  					x: utils_flattenExpression(mustache_readSection__combine(conditions)),
  					f: children = []
  				});
  			}
  		} else {
  			child = parser.read(READERS);

  			if (!child) {
  				break;
  			}

  			children.push(child);
  		}
  	} while (!closed);

  	if (unlessBlock) {
  		// special case - `with` should become `if-with` (TODO is this right?
  		// seems to me that `with` ought to behave consistently, regardless
  		// of the presence/absence of `else`. In other words should always
  		// be `if-with`
  		if (section.n === SECTION_WITH) {
  			section.n = SECTION_IF_WITH;
  		}

  		section.l = unlessBlock;
  	}

  	utils_refineExpression(expression, section);

  	// TODO if a section is empty it should be discarded. Don't do
  	// that here though - we need to clean everything up first, as
  	// it may contain removeable whitespace. As a temporary measure,
  	// to pass the existing tests, remove empty `f` arrays
  	if (!section.f.length) {
  		delete section.f;
  	}

  	return section;
  }

  function createUnlessBlock(expression, sectionType) {
  	var unlessBlock;

  	if (sectionType === SECTION_WITH) {
  		// special case - a `{{#with foo}}` section will render if `foo` is
  		// truthy, so the `{{else}}` section needs to render if `foo` is falsy,
  		// rather than adhering to the normal `{{#unless foo}}` logic (which
  		// treats empty arrays/objects as falsy)
  		unlessBlock = {
  			t: SECTION,
  			n: SECTION_IF,
  			f: []
  		};

  		utils_refineExpression(invert(expression), unlessBlock);
  	} else {
  		unlessBlock = {
  			t: SECTION,
  			n: SECTION_UNLESS,
  			f: []
  		};

  		utils_refineExpression(expression, unlessBlock);
  	}

  	return unlessBlock;
  }

  function invert(expression) {
  	if (expression.t === PREFIX_OPERATOR && expression.s === "!") {
  		return expression.o;
  	}

  	return {
  		t: PREFIX_OPERATOR,
  		s: "!",
  		o: parensIfNecessary(expression)
  	};
  }

  function mustache_readSection__combine(expressions) {
  	if (expressions.length === 1) {
  		return expressions[0];
  	}

  	return {
  		t: INFIX_OPERATOR,
  		s: "&&",
  		o: [parensIfNecessary(expressions[0]), parensIfNecessary(mustache_readSection__combine(expressions.slice(1)))]
  	};
  }

  function parensIfNecessary(expression) {
  	// TODO only wrap if necessary
  	return {
  		t: BRACKETED,
  		x: expression
  	};
  }

  var converters_readHtmlComment = readHtmlComment;
  var OPEN_COMMENT = "<!--",
      CLOSE_COMMENT = "-->";
  function readHtmlComment(parser) {
  	var start, content, remaining, endIndex, comment;

  	start = parser.pos;

  	if (!parser.matchString(OPEN_COMMENT)) {
  		return null;
  	}

  	remaining = parser.remaining();
  	endIndex = remaining.indexOf(CLOSE_COMMENT);

  	if (endIndex === -1) {
  		parser.error("Illegal HTML - expected closing comment sequence ('-->')");
  	}

  	content = remaining.substr(0, endIndex);
  	parser.pos += endIndex + 3;

  	comment = {
  		t: COMMENT,
  		c: content
  	};

  	if (parser.includeLinePositions) {
  		comment.p = parser.getLinePos(start);
  	}

  	return comment;
  }

  var booleanAttributes, voidElementNames, htmlEntities, controlCharacters, entityPattern, lessThan, greaterThan, amp;

  // https://github.com/kangax/html-minifier/issues/63#issuecomment-37763316
  booleanAttributes = /^(allowFullscreen|async|autofocus|autoplay|checked|compact|controls|declare|default|defaultChecked|defaultMuted|defaultSelected|defer|disabled|enabled|formNoValidate|hidden|indeterminate|inert|isMap|itemScope|loop|multiple|muted|noHref|noResize|noShade|noValidate|noWrap|open|pauseOnExit|readOnly|required|reversed|scoped|seamless|selected|sortable|translate|trueSpeed|typeMustMatch|visible)$/i;
  voidElementNames = /^(?:area|base|br|col|command|doctype|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/i;

  htmlEntities = { quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255, OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732, Alpha: 913, Beta: 914, Gamma: 915, Delta: 916, Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921, Kappa: 922, Lambda: 923, Mu: 924, Nu: 925, Xi: 926, Omicron: 927, Pi: 928, Rho: 929, Sigma: 931, Tau: 932, Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937, alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954, lambda: 955, mu: 956, nu: 957, xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963, tau: 964, upsilon: 965, phi: 966, chi: 967, psi: 968, omega: 969, thetasym: 977, upsih: 978, piv: 982, ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, image: 8465, weierp: 8472, real: 8476, trade: 8482, alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660, forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730, prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764, cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839, oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971, lang: 9001, rang: 9002, loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830 };
  controlCharacters = [8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143, 144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376];
  entityPattern = new RegExp("&(#?(?:x[\\w\\d]+|\\d+|" + Object.keys(htmlEntities).join("|") + "));?", "g");

  function decodeCharacterReferences(html) {
  	return html.replace(entityPattern, function (match, entity) {
  		var code;

  		// Handle named entities
  		if (entity[0] !== "#") {
  			code = htmlEntities[entity];
  		} else if (entity[1] === "x") {
  			code = parseInt(entity.substring(2), 16);
  		} else {
  			code = parseInt(entity.substring(1), 10);
  		}

  		if (!code) {
  			return match;
  		}

  		return String.fromCharCode(validateCode(code));
  	});
  }

  // some code points are verboten. If we were inserting HTML, the browser would replace the illegal
  // code points with alternatives in some cases - since we're bypassing that mechanism, we need
  // to replace them ourselves
  //
  // Source: http://en.wikipedia.org/wiki/Character_encodings_in_HTML#Illegal_characters
  function validateCode(code) {
  	if (!code) {
  		return 65533;
  	}

  	// line feed becomes generic whitespace
  	if (code === 10) {
  		return 32;
  	}

  	// ASCII range. (Why someone would use HTML entities for ASCII characters I don't know, but...)
  	if (code < 128) {
  		return code;
  	}

  	// code points 128-159 are dealt with leniently by browsers, but they're incorrect. We need
  	// to correct the mistake or we'll end up with missing € signs and so on
  	if (code <= 159) {
  		return controlCharacters[code - 128];
  	}

  	// basic multilingual plane
  	if (code < 55296) {
  		return code;
  	}

  	// UTF-16 surrogate halves
  	if (code <= 57343) {
  		return 65533;
  	}

  	// rest of the basic multilingual plane
  	if (code <= 65535) {
  		return code;
  	}

  	return 65533;
  }

  lessThan = /</g;
  greaterThan = />/g;
  amp = /&/g;

  function escapeHtml(str) {
  	return str.replace(amp, "&amp;").replace(lessThan, "&lt;").replace(greaterThan, "&gt;");
  }

  var leadingLinebreak = /^\s*\r?\n/,
      trailingLinebreak = /\r?\n\s*$/;

  var stripStandalones = function (items) {
  	var i, current, backOne, backTwo, lastSectionItem;

  	for (i = 1; i < items.length; i += 1) {
  		current = items[i];
  		backOne = items[i - 1];
  		backTwo = items[i - 2];

  		// if we're at the end of a [text][comment][text] sequence...
  		if (isString(current) && isComment(backOne) && isString(backTwo)) {

  			// ... and the comment is a standalone (i.e. line breaks either side)...
  			if (trailingLinebreak.test(backTwo) && leadingLinebreak.test(current)) {

  				// ... then we want to remove the whitespace after the first line break
  				items[i - 2] = backTwo.replace(trailingLinebreak, "\n");

  				// and the leading line break of the second text token
  				items[i] = current.replace(leadingLinebreak, "");
  			}
  		}

  		// if the current item is a section, and it is preceded by a linebreak, and
  		// its first item is a linebreak...
  		if (isSection(current) && isString(backOne)) {
  			if (trailingLinebreak.test(backOne) && isString(current.f[0]) && leadingLinebreak.test(current.f[0])) {
  				items[i - 1] = backOne.replace(trailingLinebreak, "\n");
  				current.f[0] = current.f[0].replace(leadingLinebreak, "");
  			}
  		}

  		// if the last item was a section, and it is followed by a linebreak, and
  		// its last item is a linebreak...
  		if (isString(current) && isSection(backOne)) {
  			lastSectionItem = lastItem(backOne.f);

  			if (isString(lastSectionItem) && trailingLinebreak.test(lastSectionItem) && leadingLinebreak.test(current)) {
  				backOne.f[backOne.f.length - 1] = lastSectionItem.replace(trailingLinebreak, "\n");
  				items[i] = current.replace(leadingLinebreak, "");
  			}
  		}
  	}

  	return items;
  };

  function isString(item) {
  	return typeof item === "string";
  }

  function isComment(item) {
  	return item.t === COMMENT || item.t === DELIMCHANGE;
  }

  function isSection(item) {
  	return (item.t === SECTION || item.t === INVERTED) && item.f;
  }

  var trimWhitespace = function (items, leadingPattern, trailingPattern) {
  	var item;

  	if (leadingPattern) {
  		item = items[0];
  		if (typeof item === "string") {
  			item = item.replace(leadingPattern, "");

  			if (!item) {
  				items.shift();
  			} else {
  				items[0] = item;
  			}
  		}
  	}

  	if (trailingPattern) {
  		item = lastItem(items);
  		if (typeof item === "string") {
  			item = item.replace(trailingPattern, "");

  			if (!item) {
  				items.pop();
  			} else {
  				items[items.length - 1] = item;
  			}
  		}
  	}
  };

  var utils_cleanup = cleanup;
  var contiguousWhitespace = /[ \t\f\r\n]+/g;
  var preserveWhitespaceElements = /^(?:pre|script|style|textarea)$/i;
  var utils_cleanup__leadingWhitespace = /^[ \t\f\r\n]+/;
  var trailingWhitespace = /[ \t\f\r\n]+$/;
  var leadingNewLine = /^(?:\r\n|\r|\n)/;
  var trailingNewLine = /(?:\r\n|\r|\n)$/;
  function cleanup(items, stripComments, preserveWhitespace, removeLeadingWhitespace, removeTrailingWhitespace) {
  	var i, item, previousItem, nextItem, preserveWhitespaceInsideFragment, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment, key;

  	// First pass - remove standalones and comments etc
  	stripStandalones(items);

  	i = items.length;
  	while (i--) {
  		item = items[i];

  		// Remove delimiter changes, unsafe elements etc
  		if (item.exclude) {
  			items.splice(i, 1);
  		}

  		// Remove comments, unless we want to keep them
  		else if (stripComments && item.t === COMMENT) {
  			items.splice(i, 1);
  		}
  	}

  	// If necessary, remove leading and trailing whitespace
  	trimWhitespace(items, removeLeadingWhitespace ? utils_cleanup__leadingWhitespace : null, removeTrailingWhitespace ? trailingWhitespace : null);

  	i = items.length;
  	while (i--) {
  		item = items[i];

  		// Recurse
  		if (item.f) {
  			var isPreserveWhitespaceElement = item.t === ELEMENT && preserveWhitespaceElements.test(item.e);
  			preserveWhitespaceInsideFragment = preserveWhitespace || isPreserveWhitespaceElement;

  			if (!preserveWhitespace && isPreserveWhitespaceElement) {
  				trimWhitespace(item.f, leadingNewLine, trailingNewLine);
  			}

  			if (!preserveWhitespaceInsideFragment) {
  				previousItem = items[i - 1];
  				nextItem = items[i + 1];

  				// if the previous item was a text item with trailing whitespace,
  				// remove leading whitespace inside the fragment
  				if (!previousItem || typeof previousItem === "string" && trailingWhitespace.test(previousItem)) {
  					removeLeadingWhitespaceInsideFragment = true;
  				}

  				// and vice versa
  				if (!nextItem || typeof nextItem === "string" && utils_cleanup__leadingWhitespace.test(nextItem)) {
  					removeTrailingWhitespaceInsideFragment = true;
  				}
  			}

  			cleanup(item.f, stripComments, preserveWhitespaceInsideFragment, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);
  		}

  		// Split if-else blocks into two (an if, and an unless)
  		if (item.l) {
  			cleanup(item.l.f, stripComments, preserveWhitespace, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);

  			items.splice(i + 1, 0, item.l);
  			delete item.l; // TODO would be nice if there was a way around this
  		}

  		// Clean up element attributes
  		if (item.a) {
  			for (key in item.a) {
  				if (item.a.hasOwnProperty(key) && typeof item.a[key] !== "string") {
  					cleanup(item.a[key], stripComments, preserveWhitespace, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);
  				}
  			}
  		}

  		// Clean up conditional attributes
  		if (item.m) {
  			cleanup(item.m, stripComments, preserveWhitespace, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);
  		}

  		// Clean up event handlers
  		if (item.v) {
  			for (key in item.v) {
  				if (item.v.hasOwnProperty(key)) {
  					// clean up names
  					if (isArray(item.v[key].n)) {
  						cleanup(item.v[key].n, stripComments, preserveWhitespace, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);
  					}

  					// clean up params
  					if (isArray(item.v[key].d)) {
  						cleanup(item.v[key].d, stripComments, preserveWhitespace, removeLeadingWhitespaceInsideFragment, removeTrailingWhitespaceInsideFragment);
  					}
  				}
  			}
  		}
  	}

  	// final pass - fuse text nodes together
  	i = items.length;
  	while (i--) {
  		if (typeof items[i] === "string") {
  			if (typeof items[i + 1] === "string") {
  				items[i] = items[i] + items[i + 1];
  				items.splice(i + 1, 1);
  			}

  			if (!preserveWhitespace) {
  				items[i] = items[i].replace(contiguousWhitespace, " ");
  			}

  			if (items[i] === "") {
  				items.splice(i, 1);
  			}
  		}
  	}
  }

  var element_readClosingTag = readClosingTag;
  var closingTagPattern = /^([a-zA-Z]{1,}:?[a-zA-Z0-9\-]*)\s*\>/;
  function readClosingTag(parser) {
  	var start, tag;

  	start = parser.pos;

  	// are we looking at a closing tag?
  	if (!parser.matchString("</")) {
  		return null;
  	}

  	if (tag = parser.matchPattern(closingTagPattern)) {
  		if (parser.inside && tag !== parser.inside) {
  			parser.pos = start;
  			return null;
  		}

  		return {
  			t: CLOSING_TAG,
  			e: tag
  		};
  	}

  	// We have an illegal closing tag, report it
  	parser.pos -= 2;
  	parser.error("Illegal closing tag");
  }

  var getLowestIndex = function (haystack, needles) {
  	var i, index, lowest;

  	i = needles.length;
  	while (i--) {
  		index = haystack.indexOf(needles[i]);

  		// short circuit
  		if (!index) {
  			return 0;
  		}

  		if (index === -1) {
  			continue;
  		}

  		if (!lowest || index < lowest) {
  			lowest = index;
  		}
  	}

  	return lowest || -1;
  };

  var element_readAttribute = readAttribute;

  var attributeNamePattern = /^[^\s"'>\/=]+/,
      unquotedAttributeValueTextPattern = /^[^\s"'=<>`]+/;
  function readAttribute(parser) {
  	var attr, name, value;

  	parser.allowWhitespace();

  	name = parser.matchPattern(attributeNamePattern);
  	if (!name) {
  		return null;
  	}

  	attr = { name: name };

  	value = readAttributeValue(parser);
  	if (value != null) {
  		// not null/undefined
  		attr.value = value;
  	}

  	return attr;
  }

  function readAttributeValue(parser) {
  	var start, valueStart, startDepth, value;

  	start = parser.pos;

  	// next character must be `=`, `/`, `>` or whitespace
  	if (!/[=\/>\s]/.test(parser.nextChar())) {
  		parser.error("Expected `=`, `/`, `>` or whitespace");
  	}

  	parser.allowWhitespace();

  	if (!parser.matchString("=")) {
  		parser.pos = start;
  		return null;
  	}

  	parser.allowWhitespace();

  	valueStart = parser.pos;
  	startDepth = parser.sectionDepth;

  	value = readQuotedAttributeValue(parser, "'") || readQuotedAttributeValue(parser, "\"") || readUnquotedAttributeValue(parser);

  	if (value === null) {
  		parser.error("Expected valid attribute value");
  	}

  	if (parser.sectionDepth !== startDepth) {
  		parser.pos = valueStart;
  		parser.error("An attribute value must contain as many opening section tags as closing section tags");
  	}

  	if (!value.length) {
  		return "";
  	}

  	if (value.length === 1 && typeof value[0] === "string") {
  		return decodeCharacterReferences(value[0]);
  	}

  	return value;
  }

  function readUnquotedAttributeValueToken(parser) {
  	var start, text, haystack, needles, index;

  	start = parser.pos;

  	text = parser.matchPattern(unquotedAttributeValueTextPattern);

  	if (!text) {
  		return null;
  	}

  	haystack = text;
  	needles = parser.tags.map(function (t) {
  		return t.open;
  	}); // TODO refactor... we do this in readText.js as well

  	if ((index = getLowestIndex(haystack, needles)) !== -1) {
  		text = text.substr(0, index);
  		parser.pos = start + text.length;
  	}

  	return text;
  }

  function readUnquotedAttributeValue(parser) {
  	var tokens, token;

  	parser.inAttribute = true;

  	tokens = [];

  	token = converters_readMustache(parser) || readUnquotedAttributeValueToken(parser);
  	while (token !== null) {
  		tokens.push(token);
  		token = converters_readMustache(parser) || readUnquotedAttributeValueToken(parser);
  	}

  	if (!tokens.length) {
  		return null;
  	}

  	parser.inAttribute = false;
  	return tokens;
  }

  function readQuotedAttributeValue(parser, quoteMark) {
  	var start, tokens, token;

  	start = parser.pos;

  	if (!parser.matchString(quoteMark)) {
  		return null;
  	}

  	parser.inAttribute = quoteMark;

  	tokens = [];

  	token = converters_readMustache(parser) || readQuotedStringToken(parser, quoteMark);
  	while (token !== null) {
  		tokens.push(token);
  		token = converters_readMustache(parser) || readQuotedStringToken(parser, quoteMark);
  	}

  	if (!parser.matchString(quoteMark)) {
  		parser.pos = start;
  		return null;
  	}

  	parser.inAttribute = false;

  	return tokens;
  }

  function readQuotedStringToken(parser, quoteMark) {
  	var start, index, haystack, needles;

  	start = parser.pos;
  	haystack = parser.remaining();

  	needles = parser.tags.map(function (t) {
  		return t.open;
  	}); // TODO refactor... we do this in readText.js as well
  	needles.push(quoteMark);

  	index = getLowestIndex(haystack, needles);

  	if (index === -1) {
  		parser.error("Quoted attribute value must have a closing quote");
  	}

  	if (!index) {
  		return null;
  	}

  	parser.pos += index;
  	return haystack.substr(0, index);
  }

  var JsonParser, specials, specialsPattern, parseJSON__numberPattern, placeholderPattern, placeholderAtStartPattern, onlyWhitespace;

  specials = {
  	"true": true,
  	"false": false,
  	undefined: undefined,
  	"null": null
  };

  specialsPattern = new RegExp("^(?:" + Object.keys(specials).join("|") + ")");
  parseJSON__numberPattern = /^(?:[+-]?)(?:(?:(?:0|[1-9]\d*)?\.\d+)|(?:(?:0|[1-9]\d*)\.)|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?/;
  placeholderPattern = /\$\{([^\}]+)\}/g;
  placeholderAtStartPattern = /^\$\{([^\}]+)\}/;
  onlyWhitespace = /^\s*$/;

  JsonParser = parse_Parser.extend({
  	init: function (str, options) {
  		this.values = options.values;
  		this.allowWhitespace();
  	},

  	postProcess: function (result) {
  		if (result.length !== 1 || !onlyWhitespace.test(this.leftover)) {
  			return null;
  		}

  		return { value: result[0].v };
  	},

  	converters: [function getPlaceholder(parser) {
  		var placeholder;

  		if (!parser.values) {
  			return null;
  		}

  		placeholder = parser.matchPattern(placeholderAtStartPattern);

  		if (placeholder && parser.values.hasOwnProperty(placeholder)) {
  			return { v: parser.values[placeholder] };
  		}
  	}, function getSpecial(parser) {
  		var special;

  		if (special = parser.matchPattern(specialsPattern)) {
  			return { v: specials[special] };
  		}
  	}, function getNumber(parser) {
  		var number;

  		if (number = parser.matchPattern(parseJSON__numberPattern)) {
  			return { v: +number };
  		}
  	}, function getString(parser) {
  		var stringLiteral = readStringLiteral(parser),
  		    values;

  		if (stringLiteral && (values = parser.values)) {
  			return {
  				v: stringLiteral.v.replace(placeholderPattern, function (match, $1) {
  					return $1 in values ? values[$1] : $1;
  				})
  			};
  		}

  		return stringLiteral;
  	}, function getObject(parser) {
  		var result, pair;

  		if (!parser.matchString("{")) {
  			return null;
  		}

  		result = {};

  		parser.allowWhitespace();

  		if (parser.matchString("}")) {
  			return { v: result };
  		}

  		while (pair = getKeyValuePair(parser)) {
  			result[pair.key] = pair.value;

  			parser.allowWhitespace();

  			if (parser.matchString("}")) {
  				return { v: result };
  			}

  			if (!parser.matchString(",")) {
  				return null;
  			}
  		}

  		return null;
  	}, function getArray(parser) {
  		var result, valueToken;

  		if (!parser.matchString("[")) {
  			return null;
  		}

  		result = [];

  		parser.allowWhitespace();

  		if (parser.matchString("]")) {
  			return { v: result };
  		}

  		while (valueToken = parser.read()) {
  			result.push(valueToken.v);

  			parser.allowWhitespace();

  			if (parser.matchString("]")) {
  				return { v: result };
  			}

  			if (!parser.matchString(",")) {
  				return null;
  			}

  			parser.allowWhitespace();
  		}

  		return null;
  	}]
  });

  function getKeyValuePair(parser) {
  	var key, valueToken, pair;

  	parser.allowWhitespace();

  	key = shared_readKey(parser);

  	if (!key) {
  		return null;
  	}

  	pair = { key: key };

  	parser.allowWhitespace();
  	if (!parser.matchString(":")) {
  		return null;
  	}
  	parser.allowWhitespace();

  	valueToken = parser.read();
  	if (!valueToken) {
  		return null;
  	}

  	pair.value = valueToken.v;

  	return pair;
  }

  var parseJSON = function (str, values) {
  	var parser = new JsonParser(str, {
  		values: values
  	});

  	return parser.result;
  };

  // TODO clean this up, it's shocking
  var element_processDirective = processDirective;
  var methodCallPattern = /^([a-zA-Z_$][a-zA-Z_$0-9]*)\(/,
      methodCallExcessPattern = /\)\s*$/,
      ExpressionParser;

  ExpressionParser = parse_Parser.extend({
  	converters: [converters_readExpression]
  });
  function processDirective(tokens, parentParser) {
  	var result, match, parser, args, token, colonIndex, directiveName, directiveArgs, parsed;

  	if (typeof tokens === "string") {
  		if (match = methodCallPattern.exec(tokens)) {
  			var end = tokens.lastIndexOf(")");

  			// check for invalid method calls
  			if (!methodCallExcessPattern.test(tokens)) {
  				parentParser.error("Invalid input after method call expression '" + tokens.slice(end + 1) + "'");
  			}

  			result = { m: match[1] };
  			args = "[" + tokens.slice(result.m.length + 1, end) + "]";

  			parser = new ExpressionParser(args);
  			result.a = utils_flattenExpression(parser.result[0]);

  			return result;
  		}

  		if (tokens.indexOf(":") === -1) {
  			return tokens.trim();
  		}

  		tokens = [tokens];
  	}

  	result = {};

  	directiveName = [];
  	directiveArgs = [];

  	if (tokens) {
  		while (tokens.length) {
  			token = tokens.shift();

  			if (typeof token === "string") {
  				colonIndex = token.indexOf(":");

  				if (colonIndex === -1) {
  					directiveName.push(token);
  				} else {

  					// is the colon the first character?
  					if (colonIndex) {
  						// no
  						directiveName.push(token.substr(0, colonIndex));
  					}

  					// if there is anything after the colon in this token, treat
  					// it as the first token of the directiveArgs fragment
  					if (token.length > colonIndex + 1) {
  						directiveArgs[0] = token.substring(colonIndex + 1);
  					}

  					break;
  				}
  			} else {
  				directiveName.push(token);
  			}
  		}

  		directiveArgs = directiveArgs.concat(tokens);
  	}

  	if (!directiveName.length) {
  		result = "";
  	} else if (directiveArgs.length || typeof directiveName !== "string") {
  		result = {
  			// TODO is this really necessary? just use the array
  			n: directiveName.length === 1 && typeof directiveName[0] === "string" ? directiveName[0] : directiveName
  		};

  		if (directiveArgs.length === 1 && typeof directiveArgs[0] === "string") {
  			parsed = parseJSON("[" + directiveArgs[0] + "]");
  			result.a = parsed ? parsed.value : directiveArgs[0].trim();
  		} else {
  			result.d = directiveArgs;
  		}
  	} else {
  		result = directiveName;
  	}

  	return result;
  }

  var tagNamePattern = /^[a-zA-Z]{1,}:?[a-zA-Z0-9\-]*/,
      validTagNameFollower = /^[\s\n\/>]/,
      onPattern = /^on/,
      proxyEventPattern = /^on-([a-zA-Z\\*\\.$_][a-zA-Z\\*\\.$_0-9\-]+)$/,
      reservedEventNames = /^(?:change|reset|teardown|update|construct|config|init|render|unrender|detach|insert)$/,
      directives = { "intro-outro": "t0", intro: "t1", outro: "t2", decorator: "o" },
      exclude = { exclude: true },
      disallowedContents;

  // based on http://developers.whatwg.org/syntax.html#syntax-tag-omission
  disallowedContents = {
  	li: ["li"],
  	dt: ["dt", "dd"],
  	dd: ["dt", "dd"],
  	p: "address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul".split(" "),
  	rt: ["rt", "rp"],
  	rp: ["rt", "rp"],
  	optgroup: ["optgroup"],
  	option: ["option", "optgroup"],
  	thead: ["tbody", "tfoot"],
  	tbody: ["tbody", "tfoot"],
  	tfoot: ["tbody"],
  	tr: ["tr", "tbody"],
  	td: ["td", "th", "tr"],
  	th: ["td", "th", "tr"]
  };

  var converters_readElement = readElement;

  function readElement(parser) {
  	var start, element, directiveName, match, addProxyEvent, attribute, directive, selfClosing, children, partials, hasPartials, child, closed, pos, remaining, closingTag;

  	start = parser.pos;

  	if (parser.inside || parser.inAttribute) {
  		return null;
  	}

  	if (!parser.matchString("<")) {
  		return null;
  	}

  	// if this is a closing tag, abort straight away
  	if (parser.nextChar() === "/") {
  		return null;
  	}

  	element = {};
  	if (parser.includeLinePositions) {
  		element.p = parser.getLinePos(start);
  	}

  	if (parser.matchString("!")) {
  		element.t = DOCTYPE;
  		if (!parser.matchPattern(/^doctype/i)) {
  			parser.error("Expected DOCTYPE declaration");
  		}

  		element.a = parser.matchPattern(/^(.+?)>/);
  		return element;
  	}

  	element.t = ELEMENT;

  	// element name
  	element.e = parser.matchPattern(tagNamePattern);
  	if (!element.e) {
  		return null;
  	}

  	// next character must be whitespace, closing solidus or '>'
  	if (!validTagNameFollower.test(parser.nextChar())) {
  		parser.error("Illegal tag name");
  	}

  	addProxyEvent = function (name, directive) {
  		var directiveName = directive.n || directive;

  		if (reservedEventNames.test(directiveName)) {
  			parser.pos -= directiveName.length;
  			parser.error("Cannot use reserved event names (change, reset, teardown, update, construct, config, init, render, unrender, detach, insert)");
  		}

  		element.v[name] = directive;
  	};

  	parser.allowWhitespace();

  	// directives and attributes
  	while (attribute = converters_readMustache(parser) || element_readAttribute(parser)) {
  		// regular attributes
  		if (attribute.name) {
  			// intro, outro, decorator
  			if (directiveName = directives[attribute.name]) {
  				element[directiveName] = element_processDirective(attribute.value, parser);
  			}

  			// on-click etc
  			else if (match = proxyEventPattern.exec(attribute.name)) {
  				if (!element.v) element.v = {};
  				directive = element_processDirective(attribute.value, parser);
  				addProxyEvent(match[1], directive);
  			} else {
  				if (!parser.sanitizeEventAttributes || !onPattern.test(attribute.name)) {
  					if (!element.a) element.a = {};
  					element.a[attribute.name] = attribute.value || (attribute.value === "" ? "" : 0);
  				}
  			}
  		}

  		// {{#if foo}}class='foo'{{/if}}
  		else {
  			if (!element.m) element.m = [];
  			element.m.push(attribute);
  		}

  		parser.allowWhitespace();
  	}

  	// allow whitespace before closing solidus
  	parser.allowWhitespace();

  	// self-closing solidus?
  	if (parser.matchString("/")) {
  		selfClosing = true;
  	}

  	// closing angle bracket
  	if (!parser.matchString(">")) {
  		return null;
  	}

  	var lowerCaseName = element.e.toLowerCase();
  	var preserveWhitespace = parser.preserveWhitespace;

  	if (!selfClosing && !voidElementNames.test(element.e)) {
  		parser.elementStack.push(lowerCaseName);

  		// Special case - if we open a script element, further tags should
  		// be ignored unless they're a closing script element
  		if (lowerCaseName === "script" || lowerCaseName === "style") {
  			parser.inside = lowerCaseName;
  		}

  		children = [];
  		partials = create(null);

  		do {
  			pos = parser.pos;
  			remaining = parser.remaining();

  			// if for example we're in an <li> element, and we see another
  			// <li> tag, close the first so they become siblings
  			if (!canContain(lowerCaseName, remaining)) {
  				closed = true;
  			}

  			// closing tag
  			else if (closingTag = element_readClosingTag(parser)) {
  				closed = true;

  				var closingTagName = closingTag.e.toLowerCase();

  				// if this *isn't* the closing tag for the current element...
  				if (closingTagName !== lowerCaseName) {
  					// rewind parser
  					parser.pos = pos;

  					// if it doesn't close a parent tag, error
  					if (! ~parser.elementStack.indexOf(closingTagName)) {
  						var errorMessage = "Unexpected closing tag";

  						// add additional help for void elements, since component names
  						// might clash with them
  						if (voidElementNames.test(closingTagName)) {
  							errorMessage += " (<" + closingTagName + "> is a void element - it cannot contain children)";
  						}

  						parser.error(errorMessage);
  					}
  				}
  			}

  			// implicit close by closing section tag. TODO clean this up
  			else if (child = section_readClosing(parser, { open: parser.standardDelimiters[0], close: parser.standardDelimiters[1] })) {
  				closed = true;
  				parser.pos = pos;
  			} else {
  				if (child = parser.read(PARTIAL_READERS)) {
  					if (partials[child.n]) {
  						parser.pos = pos;
  						parser.error("Duplicate partial definition");
  					}

  					utils_cleanup(child.f, parser.stripComments, preserveWhitespace, !preserveWhitespace, !preserveWhitespace);

  					partials[child.n] = child.f;
  					hasPartials = true;
  				} else {
  					if (child = parser.read(READERS)) {
  						children.push(child);
  					} else {
  						closed = true;
  					}
  				}
  			}
  		} while (!closed);

  		if (children.length) {
  			element.f = children;
  		}

  		if (hasPartials) {
  			element.p = partials;
  		}

  		parser.elementStack.pop();
  	}

  	parser.inside = null;

  	if (parser.sanitizeElements && parser.sanitizeElements.indexOf(lowerCaseName) !== -1) {
  		return exclude;
  	}

  	return element;
  }

  function canContain(name, remaining) {
  	var match, disallowed;

  	match = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(remaining);
  	disallowed = disallowedContents[name];

  	if (!match || !disallowed) {
  		return true;
  	}

  	return ! ~disallowed.indexOf(match[1].toLowerCase());
  }

  var converters_readText = readText;
  function readText(parser) {
  	var index, remaining, disallowed, barrier;

  	remaining = parser.remaining();

  	barrier = parser.inside ? "</" + parser.inside : "<";

  	if (parser.inside && !parser.interpolate[parser.inside]) {
  		index = remaining.indexOf(barrier);
  	} else {
  		disallowed = parser.tags.map(function (t) {
  			return t.open;
  		});
  		disallowed = disallowed.concat(parser.tags.map(function (t) {
  			return "\\" + t.open;
  		}));

  		// http://developers.whatwg.org/syntax.html#syntax-attributes
  		if (parser.inAttribute === true) {
  			// we're inside an unquoted attribute value
  			disallowed.push("\"", "'", "=", "<", ">", "`");
  		} else if (parser.inAttribute) {
  			// quoted attribute value
  			disallowed.push(parser.inAttribute);
  		} else {
  			disallowed.push(barrier);
  		}

  		index = getLowestIndex(remaining, disallowed);
  	}

  	if (!index) {
  		return null;
  	}

  	if (index === -1) {
  		index = remaining.length;
  	}

  	parser.pos += index;

  	return parser.inside ? remaining.substr(0, index) : decodeCharacterReferences(remaining.substr(0, index));
  }

  var utils_escapeRegExp = escapeRegExp;
  var utils_escapeRegExp__pattern = /[-/\\^$*+?.()|[\]{}]/g;
  function escapeRegExp(str) {
  	return str.replace(utils_escapeRegExp__pattern, "\\$&");
  }

  var converters_readPartialDefinitionComment = readPartialDefinitionComment;

  var startPattern = /^<!--\s*/,
      namePattern = /s*>\s*([a-zA-Z_$][-a-zA-Z_$0-9]*)\s*/,
      finishPattern = /\s*-->/,
      child;

  function readPartialDefinitionComment(parser) {
  	var firstPos = parser.pos,
  	    open = parser.standardDelimiters[0],
  	    close = parser.standardDelimiters[1],
  	    content = undefined,
  	    closed = undefined;

  	if (!parser.matchPattern(startPattern) || !parser.matchString(open)) {
  		parser.pos = firstPos;
  		return null;
  	}

  	var name = parser.matchPattern(namePattern);

  	warnOnceIfDebug("Inline partial comments are deprecated.\nUse this...\n  {{#partial " + name + "}} ... {{/partial}}\n\n...instead of this:\n  <!-- {{>" + name + "}} --> ... <!-- {{/" + name + "}} -->'");

  	// make sure the rest of the comment is in the correct place
  	if (!parser.matchString(close) || !parser.matchPattern(finishPattern)) {
  		parser.pos = firstPos;
  		return null;
  	}

  	content = [];

  	var endPattern = new RegExp("^<!--\\s*" + utils_escapeRegExp(open) + "\\s*\\/\\s*" + name + "\\s*" + utils_escapeRegExp(close) + "\\s*-->");

  	do {
  		if (parser.matchPattern(endPattern)) {
  			closed = true;
  		} else {
  			child = parser.read(READERS);
  			if (!child) {
  				parser.error("expected closing comment ('<!-- " + open + "/" + name + "" + close + " -->')");
  			}

  			content.push(child);
  		}
  	} while (!closed);

  	return {
  		t: INLINE_PARTIAL,
  		f: content,
  		n: name
  	};
  }

  var converters_readPartialDefinitionSection = readPartialDefinitionSection;
  var partialDefinitionSectionPattern = /^#\s*partial\s+/;
  function readPartialDefinitionSection(parser) {
  	var start, name, content, child, closed;

  	start = parser.pos;

  	var delimiters = parser.standardDelimiters;

  	if (!parser.matchString(delimiters[0])) {
  		return null;
  	}

  	if (!parser.matchPattern(partialDefinitionSectionPattern)) {
  		parser.pos = start;
  		return null;
  	}

  	name = parser.matchPattern(/^[a-zA-Z_$][a-zA-Z_$0-9\-]*/);

  	if (!name) {
  		parser.error("expected legal partial name");
  	}

  	if (!parser.matchString(delimiters[1])) {
  		parser.error("Expected closing delimiter '" + delimiters[1] + "'");
  	}

  	content = [];

  	do {
  		// TODO clean this up
  		if (child = section_readClosing(parser, { open: parser.standardDelimiters[0], close: parser.standardDelimiters[1] })) {
  			if (!child.r === "partial") {
  				parser.error("Expected " + delimiters[0] + "/partial" + delimiters[1]);
  			}

  			closed = true;
  		} else {
  			child = parser.read(READERS);

  			if (!child) {
  				parser.error("Expected " + delimiters[0] + "/partial" + delimiters[1]);
  			}

  			content.push(child);
  		}
  	} while (!closed);

  	return {
  		t: INLINE_PARTIAL,
  		n: name,
  		f: content
  	};
  }

  var converters_readTemplate = readTemplate;
  function readTemplate(parser) {
  	var fragment = [];
  	var partials = create(null);
  	var hasPartials = false;

  	var preserveWhitespace = parser.preserveWhitespace;

  	while (parser.pos < parser.str.length) {
  		var pos = parser.pos,
  		    item = undefined,
  		    partial = undefined;

  		if (partial = parser.read(PARTIAL_READERS)) {
  			if (partials[partial.n]) {
  				parser.pos = pos;
  				parser.error("Duplicated partial definition");
  			}

  			utils_cleanup(partial.f, parser.stripComments, preserveWhitespace, !preserveWhitespace, !preserveWhitespace);

  			partials[partial.n] = partial.f;
  			hasPartials = true;
  		} else if (item = parser.read(READERS)) {
  			fragment.push(item);
  		} else {
  			parser.error("Unexpected template content");
  		}
  	}

  	var result = {
  		v: TEMPLATE_VERSION,
  		t: fragment
  	};

  	if (hasPartials) {
  		result.p = partials;
  	}

  	return result;
  }

  var _parse = parse;

  var STANDARD_READERS = [mustache_readPartial, mustache_readUnescaped, mustache_readSection, mustache_readYielder, mustache_readInterpolator, readMustacheComment];
  var TRIPLE_READERS = [mustache_readTriple];
  var STATIC_READERS = [mustache_readUnescaped, mustache_readSection, mustache_readInterpolator]; // TODO does it make sense to have a static section?

  var StandardParser = undefined;
  function parse(template, options) {
  	return new StandardParser(template, options || {}).result;
  }

  var READERS = [converters_readMustache, converters_readHtmlComment, converters_readElement, converters_readText];
  var PARTIAL_READERS = [converters_readPartialDefinitionComment, converters_readPartialDefinitionSection];

  StandardParser = parse_Parser.extend({
  	init: function (str, options) {
  		var tripleDelimiters = options.tripleDelimiters || ["{{{", "}}}"],
  		    staticDelimiters = options.staticDelimiters || ["[[", "]]"],
  		    staticTripleDelimiters = options.staticTripleDelimiters || ["[[[", "]]]"];

  		this.standardDelimiters = options.delimiters || ["{{", "}}"];

  		this.tags = [{ isStatic: false, isTriple: false, open: this.standardDelimiters[0], close: this.standardDelimiters[1], readers: STANDARD_READERS }, { isStatic: false, isTriple: true, open: tripleDelimiters[0], close: tripleDelimiters[1], readers: TRIPLE_READERS }, { isStatic: true, isTriple: false, open: staticDelimiters[0], close: staticDelimiters[1], readers: STATIC_READERS }, { isStatic: true, isTriple: true, open: staticTripleDelimiters[0], close: staticTripleDelimiters[1], readers: TRIPLE_READERS }];

  		this.sortMustacheTags();

  		this.sectionDepth = 0;
  		this.elementStack = [];

  		this.interpolate = {
  			script: !options.interpolate || options.interpolate.script !== false,
  			style: !options.interpolate || options.interpolate.style !== false
  		};

  		if (options.sanitize === true) {
  			options.sanitize = {
  				// blacklist from https://code.google.com/p/google-caja/source/browse/trunk/src/com/google/caja/lang/html/html4-elements-whitelist.json
  				elements: "applet base basefont body frame frameset head html isindex link meta noframes noscript object param script style title".split(" "),
  				eventAttributes: true
  			};
  		}

  		this.stripComments = options.stripComments !== false;
  		this.preserveWhitespace = options.preserveWhitespace;
  		this.sanitizeElements = options.sanitize && options.sanitize.elements;
  		this.sanitizeEventAttributes = options.sanitize && options.sanitize.eventAttributes;
  		this.includeLinePositions = options.includeLinePositions;
  	},

  	postProcess: function (result) {
  		// special case - empty string
  		if (!result.length) {
  			return { t: [], v: TEMPLATE_VERSION };
  		}

  		if (this.sectionDepth > 0) {
  			this.error("A section was left open");
  		}

  		utils_cleanup(result[0].t, this.stripComments, this.preserveWhitespace, !this.preserveWhitespace, !this.preserveWhitespace);

  		return result[0];
  	},

  	converters: [converters_readTemplate],

  	sortMustacheTags: function () {
  		// Sort in order of descending opening delimiter length (longer first),
  		// to protect against opening delimiters being substrings of each other
  		this.tags.sort(function (a, b) {
  			return b.open.length - a.open.length;
  		});
  	}
  });

  var parseOptions = ["preserveWhitespace", "sanitize", "stripComments", "delimiters", "tripleDelimiters", "interpolate"];

  var parser = {
  	fromId: fromId, isHashedId: isHashedId, isParsed: isParsed, getParseOptions: getParseOptions, createHelper: template_parser__createHelper,
  	parse: doParse
  };

  function template_parser__createHelper(parseOptions) {
  	var helper = create(parser);
  	helper.parse = function (template, options) {
  		return doParse(template, options || parseOptions);
  	};
  	return helper;
  }

  function doParse(template, parseOptions) {
  	if (!_parse) {
  		throw new Error("Missing Ractive.parse - cannot parse template. Either preparse or use the version that includes the parser");
  	}

  	return _parse(template, parseOptions || this.options);
  }

  function fromId(id, options) {
  	var template;

  	if (!isClient) {
  		if (options && options.noThrow) {
  			return;
  		}
  		throw new Error("Cannot retrieve template #" + id + " as Ractive is not running in a browser.");
  	}

  	if (isHashedId(id)) {
  		id = id.substring(1);
  	}

  	if (!(template = document.getElementById(id))) {
  		if (options && options.noThrow) {
  			return;
  		}
  		throw new Error("Could not find template element with id #" + id);
  	}

  	if (template.tagName.toUpperCase() !== "SCRIPT") {
  		if (options && options.noThrow) {
  			return;
  		}
  		throw new Error("Template element with id #" + id + ", must be a <script> element");
  	}

  	return "textContent" in template ? template.textContent : template.innerHTML;
  }

  function isHashedId(id) {
  	return id && id[0] === "#";
  }

  function isParsed(template) {
  	return !(typeof template === "string");
  }

  function getParseOptions(ractive) {
  	// Could be Ractive or a Component
  	if (ractive.defaults) {
  		ractive = ractive.defaults;
  	}

  	return parseOptions.reduce(function (val, key) {
  		val[key] = ractive[key];
  		return val;
  	}, {});
  }

  var template_parser = parser;

  var templateConfigurator = {
  	name: "template",

  	extend: function extend(Parent, proto, options) {
  		var template;

  		// only assign if exists
  		if ("template" in options) {
  			template = options.template;

  			if (typeof template === "function") {
  				proto.template = template;
  			} else {
  				proto.template = parseIfString(template, proto);
  			}
  		}
  	},

  	init: function init(Parent, ractive, options) {
  		var template, fn;

  		// TODO because of prototypal inheritance, we might just be able to use
  		// ractive.template, and not bother passing through the Parent object.
  		// At present that breaks the test mocks' expectations
  		template = "template" in options ? options.template : Parent.prototype.template;

  		if (typeof template === "function") {
  			fn = template;
  			template = getDynamicTemplate(ractive, fn);

  			ractive._config.template = {
  				fn: fn,
  				result: template
  			};
  		}

  		template = parseIfString(template, ractive);

  		// TODO the naming of this is confusing - ractive.template refers to [...],
  		// but Component.prototype.template refers to {v:1,t:[],p:[]}...
  		// it's unnecessary, because the developer never needs to access
  		// ractive.template
  		ractive.template = template.t;

  		if (template.p) {
  			extendPartials(ractive.partials, template.p);
  		}
  	},

  	reset: function (ractive) {
  		var result = resetValue(ractive),
  		    parsed;

  		if (result) {
  			parsed = parseIfString(result, ractive);

  			ractive.template = parsed.t;
  			extendPartials(ractive.partials, parsed.p, true);

  			return true;
  		}
  	}
  };

  function resetValue(ractive) {
  	var initial = ractive._config.template,
  	    result;

  	// If this isn't a dynamic template, there's nothing to do
  	if (!initial || !initial.fn) {
  		return;
  	}

  	result = getDynamicTemplate(ractive, initial.fn);

  	// TODO deep equality check to prevent unnecessary re-rendering
  	// in the case of already-parsed templates
  	if (result !== initial.result) {
  		initial.result = result;
  		result = parseIfString(result, ractive);
  		return result;
  	}
  }

  function getDynamicTemplate(ractive, fn) {
  	var helper = template_template__createHelper(template_parser.getParseOptions(ractive));
  	return fn.call(ractive, helper);
  }

  function template_template__createHelper(parseOptions) {
  	var helper = create(template_parser);
  	helper.parse = function (template, options) {
  		return template_parser.parse(template, options || parseOptions);
  	};
  	return helper;
  }

  function parseIfString(template, ractive) {
  	if (typeof template === "string") {
  		// ID of an element containing the template?
  		if (template[0] === "#") {
  			template = template_parser.fromId(template);
  		}

  		template = _parse(template, template_parser.getParseOptions(ractive));
  	}

  	// Check that the template even exists
  	else if (template == undefined) {
  		throw new Error("The template cannot be " + template + ".");
  	}

  	// Check the parsed template has a version at all
  	else if (typeof template.v !== "number") {
  		throw new Error("The template parser was passed a non-string template, but the template doesn't have a version.  Make sure you're passing in the template you think you are.");
  	}

  	// Check we're using the correct version
  	else if (template.v !== TEMPLATE_VERSION) {
  		throw new Error("Mismatched template version (expected " + TEMPLATE_VERSION + ", got " + template.v + ") Please ensure you are using the latest version of Ractive.js in your build process as well as in your app");
  	}

  	return template;
  }

  function extendPartials(existingPartials, newPartials, overwrite) {
  	if (!newPartials) return;

  	// TODO there's an ambiguity here - we need to overwrite in the `reset()`
  	// case, but not initially...

  	for (var key in newPartials) {
  		if (overwrite || !existingPartials.hasOwnProperty(key)) {
  			existingPartials[key] = newPartials[key];
  		}
  	}
  }

  var template_template = templateConfigurator;

  var config_registries__registryNames, Registry, registries;

  config_registries__registryNames = ["adaptors", "components", "computed", "decorators", "easing", "events", "interpolators", "partials", "transitions"];

  Registry = function (name, useDefaults) {
  	this.name = name;
  	this.useDefaults = useDefaults;
  };

  Registry.prototype = {
  	constructor: Registry,

  	extend: function (Parent, proto, options) {
  		this.configure(this.useDefaults ? Parent.defaults : Parent, this.useDefaults ? proto : proto.constructor, options);
  	},

  	init: function () {},

  	configure: function (Parent, target, options) {
  		var name = this.name,
  		    option = options[name],
  		    registry;

  		registry = create(Parent[name]);

  		for (var key in option) {
  			registry[key] = option[key];
  		}

  		target[name] = registry;
  	},

  	reset: function (ractive) {
  		var registry = ractive[this.name];
  		var changed = false;
  		Object.keys(registry).forEach(function (key) {
  			var item = registry[key];
  			if (item._fn) {
  				if (item._fn.isOwner) {
  					registry[key] = item._fn;
  				} else {
  					delete registry[key];
  				}
  				changed = true;
  			}
  		});
  		return changed;
  	}
  };

  registries = config_registries__registryNames.map(function (name) {
  	return new Registry(name, name === "computed");
  });

  var config_registries = registries;

  /*this.configure(
  	this.useDefaults ? Parent.defaults : Parent,
  	ractive,
  	options );*/

  var wrapPrototype = wrap;

  function wrap(parent, name, method) {
  	if (!/_super/.test(method)) {
  		return method;
  	}

  	var wrapper = function wrapSuper() {
  		var superMethod = getSuperMethod(wrapper._parent, name),
  		    hasSuper = ("_super" in this),
  		    oldSuper = this._super,
  		    result;

  		this._super = superMethod;

  		result = method.apply(this, arguments);

  		if (hasSuper) {
  			this._super = oldSuper;
  		} else {
  			delete this._super;
  		}

  		return result;
  	};

  	wrapper._parent = parent;
  	wrapper._method = method;

  	return wrapper;
  }

  function getSuperMethod(parent, name) {
  	var value, method;

  	if (name in parent) {
  		value = parent[name];

  		if (typeof value === "function") {
  			method = value;
  		} else {
  			method = function returnValue() {
  				return value;
  			};
  		}
  	} else {
  		method = noop;
  	}

  	return method;
  }

  var config_deprecate = deprecate;
  function getMessage(deprecated, correct, isError) {
  	return "options." + deprecated + " has been deprecated in favour of options." + correct + "." + (isError ? " You cannot specify both options, please use options." + correct + "." : "");
  }

  function deprecateOption(options, deprecatedOption, correct) {
  	if (deprecatedOption in options) {
  		if (!(correct in options)) {
  			warnIfDebug(getMessage(deprecatedOption, correct));
  			options[correct] = options[deprecatedOption];
  		} else {
  			throw new Error(getMessage(deprecatedOption, correct, true));
  		}
  	}
  }
  function deprecate(options) {
  	deprecateOption(options, "beforeInit", "onconstruct");
  	deprecateOption(options, "init", "onrender");
  	deprecateOption(options, "complete", "oncomplete");
  	deprecateOption(options, "eventDefinitions", "events");

  	// Using extend with Component instead of options,
  	// like Human.extend( Spider ) means adaptors as a registry
  	// gets copied to options. So we have to check if actually an array
  	if (isArray(options.adaptors)) {
  		deprecateOption(options, "adaptors", "adapt");
  	}
  }

  var config, order, defaultKeys, custom, isBlacklisted, isStandardKey;

  custom = {
  	adapt: custom_adapt,
  	css: css_css,
  	data: custom_data,
  	template: template_template
  };

  defaultKeys = Object.keys(config_defaults);

  isStandardKey = makeObj(defaultKeys.filter(function (key) {
  	return !custom[key];
  }));

  // blacklisted keys that we don't double extend
  isBlacklisted = makeObj(defaultKeys.concat(config_registries.map(function (r) {
  	return r.name;
  })));

  order = [].concat(defaultKeys.filter(function (key) {
  	return !config_registries[key] && !custom[key];
  }), config_registries, custom.data, custom.template, custom.css);

  config = {
  	extend: function (Parent, proto, options) {
  		return configure("extend", Parent, proto, options);
  	},

  	init: function (Parent, ractive, options) {
  		return configure("init", Parent, ractive, options);
  	},

  	reset: function (ractive) {
  		return order.filter(function (c) {
  			return c.reset && c.reset(ractive);
  		}).map(function (c) {
  			return c.name;
  		});
  	},

  	// this defines the order. TODO this isn't used anywhere in the codebase,
  	// only in the test suite - should get rid of it
  	order: order };

  function configure(method, Parent, target, options) {
  	config_deprecate(options);

  	for (var key in options) {
  		if (isStandardKey.hasOwnProperty(key)) {
  			var value = options[key];

  			// warn the developer if they passed a function and ignore its value

  			// NOTE: we allow some functions on "el" because we duck type element lists
  			// and some libraries or ef'ed-up virtual browsers (phantomJS) return a
  			// function object as the result of querySelector methods
  			if (key !== "el" && typeof value === "function") {
  				warnIfDebug("" + key + " is a Ractive option that does not expect a function and will be ignored", method === "init" ? target : null);
  			} else {
  				target[key] = value;
  			}
  		}
  	}

  	config_registries.forEach(function (registry) {
  		registry[method](Parent, target, options);
  	});

  	custom_adapt[method](Parent, target, options);
  	template_template[method](Parent, target, options);
  	css_css[method](Parent, target, options);

  	extendOtherMethods(Parent.prototype, target, options);
  }

  function extendOtherMethods(parent, target, options) {
  	for (var key in options) {
  		if (!isBlacklisted[key] && options.hasOwnProperty(key)) {
  			var member = options[key];

  			// if this is a method that overwrites a method, wrap it:
  			if (typeof member === "function") {
  				member = wrapPrototype(parent, key, member);
  			}

  			target[key] = member;
  		}
  	}
  }

  function makeObj(array) {
  	var obj = {};
  	array.forEach(function (x) {
  		return obj[x] = true;
  	});
  	return obj;
  }

  var config_config = config;

  var prototype_bubble = Fragment$bubble;

  function Fragment$bubble() {
  	this.dirtyValue = this.dirtyArgs = true;

  	if (this.bound && typeof this.owner.bubble === "function") {
  		this.owner.bubble();
  	}
  }

  var Fragment_prototype_detach = Fragment$detach;

  function Fragment$detach() {
  	var docFrag;

  	if (this.items.length === 1) {
  		return this.items[0].detach();
  	}

  	docFrag = document.createDocumentFragment();

  	this.items.forEach(function (item) {
  		var node = item.detach();

  		// TODO The if {...} wasn't previously required - it is now, because we're
  		// forcibly detaching everything to reorder sections after an update. That's
  		// a non-ideal brute force approach, implemented to get all the tests to pass
  		// - as soon as it's replaced with something more elegant, this should
  		// revert to `docFrag.appendChild( item.detach() )`
  		if (node) {
  			docFrag.appendChild(node);
  		}
  	});

  	return docFrag;
  }

  var Fragment_prototype_find = Fragment$find;

  function Fragment$find(selector) {
  	var i, len, item, queryResult;

  	if (this.items) {
  		len = this.items.length;
  		for (i = 0; i < len; i += 1) {
  			item = this.items[i];

  			if (item.find && (queryResult = item.find(selector))) {
  				return queryResult;
  			}
  		}

  		return null;
  	}
  }

  var Fragment_prototype_findAll = Fragment$findAll;

  function Fragment$findAll(selector, query) {
  	var i, len, item;

  	if (this.items) {
  		len = this.items.length;
  		for (i = 0; i < len; i += 1) {
  			item = this.items[i];

  			if (item.findAll) {
  				item.findAll(selector, query);
  			}
  		}
  	}

  	return query;
  }

  var Fragment_prototype_findAllComponents = Fragment$findAllComponents;

  function Fragment$findAllComponents(selector, query) {
  	var i, len, item;

  	if (this.items) {
  		len = this.items.length;
  		for (i = 0; i < len; i += 1) {
  			item = this.items[i];

  			if (item.findAllComponents) {
  				item.findAllComponents(selector, query);
  			}
  		}
  	}

  	return query;
  }

  var Fragment_prototype_findComponent = Fragment$findComponent;

  function Fragment$findComponent(selector) {
  	var len, i, item, queryResult;

  	if (this.items) {
  		len = this.items.length;
  		for (i = 0; i < len; i += 1) {
  			item = this.items[i];

  			if (item.findComponent && (queryResult = item.findComponent(selector))) {
  				return queryResult;
  			}
  		}

  		return null;
  	}
  }

  var prototype_findNextNode = Fragment$findNextNode;

  function Fragment$findNextNode(item) {
  	var index = item.index,
  	    node;

  	if (this.items[index + 1]) {
  		node = this.items[index + 1].firstNode();
  	}

  	// if this is the root fragment, and there are no more items,
  	// it means we're at the end...
  	else if (this.owner === this.root) {
  		if (!this.owner.component) {
  			// TODO but something else could have been appended to
  			// this.root.el, no?
  			node = null;
  		}

  		// ...unless this is a component
  		else {
  			node = this.owner.component.findNextNode();
  		}
  	} else {
  		node = this.owner.findNextNode(this);
  	}

  	return node;
  }

  var prototype_firstNode = Fragment$firstNode;

  function Fragment$firstNode() {
  	if (this.items && this.items[0]) {
  		return this.items[0].firstNode();
  	}

  	return null;
  }

  var shared_processItems = processItems;

  function processItems(items, values, guid, counter) {
  	counter = counter || 0;

  	return items.map(function (item) {
  		var placeholderId, wrapped, value;

  		if (item.text) {
  			return item.text;
  		}

  		if (item.fragments) {
  			return item.fragments.map(function (fragment) {
  				return processItems(fragment.items, values, guid, counter);
  			}).join("");
  		}

  		placeholderId = guid + "-" + counter++;

  		if (item.keypath && (wrapped = item.root.viewmodel.wrapped[item.keypath.str])) {
  			value = wrapped.value;
  		} else {
  			value = item.getValue();
  		}

  		values[placeholderId] = value;

  		return "${" + placeholderId + "}";
  	}).join("");
  }

  var getArgsList = Fragment$getArgsList;
  function Fragment$getArgsList() {
  	var values, source, parsed, result;

  	if (this.dirtyArgs) {
  		source = shared_processItems(this.items, values = {}, this.root._guid);
  		parsed = parseJSON("[" + source + "]", values);

  		if (!parsed) {
  			result = [this.toString()];
  		} else {
  			result = parsed.value;
  		}

  		this.argsList = result;
  		this.dirtyArgs = false;
  	}

  	return this.argsList;
  }

  var getNode = Fragment$getNode;

  function Fragment$getNode() {
  	var fragment = this;

  	do {
  		if (fragment.pElement) {
  			return fragment.pElement.node;
  		}
  	} while (fragment = fragment.parent);

  	return this.root.detached || this.root.el;
  }

  var prototype_getValue = Fragment$getValue;
  function Fragment$getValue() {
  	var values, source, parsed, result;

  	if (this.dirtyValue) {
  		source = shared_processItems(this.items, values = {}, this.root._guid);
  		parsed = parseJSON(source, values);

  		if (!parsed) {
  			result = this.toString();
  		} else {
  			result = parsed.value;
  		}

  		this.value = result;
  		this.dirtyValue = false;
  	}

  	return this.value;
  }

  var shared_detach = function () {
  	return detachNode(this.node);
  };

  var Text = function (options) {
  	this.type = TEXT;
  	this.text = options.template;
  };

  Text.prototype = {
  	detach: shared_detach,

  	firstNode: function () {
  		return this.node;
  	},

  	render: function () {
  		if (!this.node) {
  			this.node = document.createTextNode(this.text);
  		}

  		return this.node;
  	},

  	toString: function (escape) {
  		return escape ? escapeHtml(this.text) : this.text;
  	},

  	unrender: function (shouldDestroy) {
  		if (shouldDestroy) {
  			return this.detach();
  		}
  	}
  };

  var items_Text = Text;

  var shared_unbind = shared_unbind__unbind;

  function shared_unbind__unbind() {
  	if (this.registered) {
  		// this was registered as a dependant
  		this.root.viewmodel.unregister(this.keypath, this);
  	}

  	if (this.resolver) {
  		this.resolver.unbind();
  	}
  }

  var Mustache_getValue = Mustache$getValue;

  function Mustache$getValue() {
  	return this.value;
  }

  var ReferenceResolver = function (owner, ref, callback) {
  	var keypath;

  	this.ref = ref;
  	this.resolved = false;

  	this.root = owner.root;
  	this.parentFragment = owner.parentFragment;
  	this.callback = callback;

  	keypath = shared_resolveRef(owner.root, ref, owner.parentFragment);
  	if (keypath != undefined) {
  		this.resolve(keypath);
  	} else {
  		global_runloop.addUnresolved(this);
  	}
  };

  ReferenceResolver.prototype = {
  	resolve: function (keypath) {
  		if (this.keypath && !keypath) {
  			// it was resolved, and now it's not. Can happen if e.g. `bar` in
  			// `{{foo[bar]}}` becomes undefined
  			global_runloop.addUnresolved(this);
  		}

  		this.resolved = true;

  		this.keypath = keypath;
  		this.callback(keypath);
  	},

  	forceResolution: function () {
  		this.resolve(getKeypath(this.ref));
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		var keypath;

  		if (this.keypath != undefined) {
  			keypath = this.keypath.replace(oldKeypath, newKeypath);
  			// was a new keypath created?
  			if (keypath !== undefined) {
  				// resolve it
  				this.resolve(keypath);
  			}
  		}
  	},

  	unbind: function () {
  		if (!this.resolved) {
  			global_runloop.removeUnresolved(this);
  		}
  	}
  };

  var Resolvers_ReferenceResolver = ReferenceResolver;

  var SpecialResolver = function (owner, ref, callback) {
  	this.parentFragment = owner.parentFragment;
  	this.ref = ref;
  	this.callback = callback;

  	this.rebind();
  };

  var props = {
  	"@keypath": { prefix: "c", prop: ["context"] },
  	"@index": { prefix: "i", prop: ["index"] },
  	"@key": { prefix: "k", prop: ["key", "index"] }
  };

  function getProp(target, prop) {
  	var value;
  	for (var i = 0; i < prop.prop.length; i++) {
  		if ((value = target[prop.prop[i]]) !== undefined) {
  			return value;
  		}
  	}
  }

  SpecialResolver.prototype = {
  	rebind: function () {
  		var ref = this.ref,
  		    fragment = this.parentFragment,
  		    prop = props[ref],
  		    value;

  		if (!prop) {
  			throw new Error("Unknown special reference \"" + ref + "\" - valid references are @index, @key and @keypath");
  		}

  		// have we already found the nearest parent?
  		if (this.cached) {
  			return this.callback(getKeypath("@" + prop.prefix + getProp(this.cached, prop)));
  		}

  		// special case for indices, which may cross component boundaries
  		if (prop.prop.indexOf("index") !== -1 || prop.prop.indexOf("key") !== -1) {
  			while (fragment) {
  				if (fragment.owner.currentSubtype === SECTION_EACH && (value = getProp(fragment, prop)) !== undefined) {
  					this.cached = fragment;

  					fragment.registerIndexRef(this);

  					return this.callback(getKeypath("@" + prop.prefix + value));
  				}

  				// watch for component boundaries
  				if (!fragment.parent && fragment.owner && fragment.owner.component && fragment.owner.component.parentFragment && !fragment.owner.component.instance.isolated) {
  					fragment = fragment.owner.component.parentFragment;
  				} else {
  					fragment = fragment.parent;
  				}
  			}
  		} else {
  			while (fragment) {
  				if ((value = getProp(fragment, prop)) !== undefined) {
  					return this.callback(getKeypath("@" + prop.prefix + value.str));
  				}

  				fragment = fragment.parent;
  			}
  		}
  	},

  	unbind: function () {
  		if (this.cached) {
  			this.cached.unregisterIndexRef(this);
  		}
  	}
  };

  var Resolvers_SpecialResolver = SpecialResolver;

  var IndexResolver = function (owner, ref, callback) {
  	this.parentFragment = owner.parentFragment;
  	this.ref = ref;
  	this.callback = callback;

  	ref.ref.fragment.registerIndexRef(this);

  	this.rebind();
  };

  IndexResolver.prototype = {
  	rebind: function () {
  		var index,
  		    ref = this.ref.ref;

  		if (ref.ref.t === "k") {
  			index = "k" + ref.fragment.key;
  		} else {
  			index = "i" + ref.fragment.index;
  		}

  		if (index !== undefined) {
  			this.callback(getKeypath("@" + index));
  		}
  	},

  	unbind: function () {
  		this.ref.ref.fragment.unregisterIndexRef(this);
  	}
  };

  var Resolvers_IndexResolver = IndexResolver;

  var Resolvers_findIndexRefs = findIndexRefs;

  function findIndexRefs(fragment, refName) {
  	var result = {},
  	    refs,
  	    fragRefs,
  	    ref,
  	    i,
  	    owner,
  	    hit = false;

  	if (!refName) {
  		result.refs = refs = {};
  	}

  	while (fragment) {
  		if ((owner = fragment.owner) && (fragRefs = owner.indexRefs)) {

  			// we're looking for a particular ref, and it's here
  			if (refName && (ref = owner.getIndexRef(refName))) {
  				result.ref = {
  					fragment: fragment,
  					ref: ref
  				};
  				return result;
  			}

  			// we're collecting refs up-tree
  			else if (!refName) {
  				for (i in fragRefs) {
  					ref = fragRefs[i];

  					// don't overwrite existing refs - they should shadow parents
  					if (!refs[ref.n]) {
  						hit = true;
  						refs[ref.n] = {
  							fragment: fragment,
  							ref: ref
  						};
  					}
  				}
  			}
  		}

  		// watch for component boundaries
  		if (!fragment.parent && fragment.owner && fragment.owner.component && fragment.owner.component.parentFragment && !fragment.owner.component.instance.isolated) {
  			result.componentBoundary = true;
  			fragment = fragment.owner.component.parentFragment;
  		} else {
  			fragment = fragment.parent;
  		}
  	}

  	if (!hit) {
  		return undefined;
  	} else {
  		return result;
  	}
  }

  findIndexRefs.resolve = function resolve(indices) {
  	var refs = {},
  	    k,
  	    ref;

  	for (k in indices.refs) {
  		ref = indices.refs[k];
  		refs[ref.ref.n] = ref.ref.t === "k" ? ref.fragment.key : ref.fragment.index;
  	}

  	return refs;
  };

  var Resolvers_createReferenceResolver = createReferenceResolver;
  function createReferenceResolver(owner, ref, callback) {
  	var indexRef;

  	if (ref.charAt(0) === "@") {
  		return new Resolvers_SpecialResolver(owner, ref, callback);
  	}

  	if (indexRef = Resolvers_findIndexRefs(owner.parentFragment, ref)) {
  		return new Resolvers_IndexResolver(owner, indexRef, callback);
  	}

  	return new Resolvers_ReferenceResolver(owner, ref, callback);
  }

  var shared_getFunctionFromString = getFunctionFromString;
  var cache = {};
  function getFunctionFromString(str, i) {
  	var fn, args;

  	if (cache[str]) {
  		return cache[str];
  	}

  	args = [];
  	while (i--) {
  		args[i] = "_" + i;
  	}

  	fn = new Function(args.join(","), "return(" + str + ")");

  	cache[str] = fn;
  	return fn;
  }

  var ExpressionResolver,
      Resolvers_ExpressionResolver__bind = Function.prototype.bind;

  ExpressionResolver = function (owner, parentFragment, expression, callback) {
  	var _this = this;

  	var ractive;

  	ractive = owner.root;

  	this.root = ractive;
  	this.parentFragment = parentFragment;
  	this.callback = callback;
  	this.owner = owner;
  	this.str = expression.s;
  	this.keypaths = [];

  	// Create resolvers for each reference
  	this.pending = expression.r.length;
  	this.refResolvers = expression.r.map(function (ref, i) {
  		return Resolvers_createReferenceResolver(_this, ref, function (keypath) {
  			_this.resolve(i, keypath);
  		});
  	});

  	this.ready = true;
  	this.bubble();
  };

  ExpressionResolver.prototype = {
  	bubble: function () {
  		if (!this.ready) {
  			return;
  		}

  		this.uniqueString = getUniqueString(this.str, this.keypaths);
  		this.keypath = createExpressionKeypath(this.uniqueString);

  		this.createEvaluator();
  		this.callback(this.keypath);
  	},

  	unbind: function () {
  		var resolver;

  		while (resolver = this.refResolvers.pop()) {
  			resolver.unbind();
  		}
  	},

  	resolve: function (index, keypath) {
  		this.keypaths[index] = keypath;
  		this.bubble();
  	},

  	createEvaluator: function () {
  		var _this = this;

  		var computation, valueGetters, signature, keypath, fn;

  		keypath = this.keypath;
  		computation = this.root.viewmodel.computations[keypath.str];

  		// only if it doesn't exist yet!
  		if (!computation) {
  			fn = shared_getFunctionFromString(this.str, this.refResolvers.length);

  			valueGetters = this.keypaths.map(function (keypath) {
  				var value;

  				if (keypath === "undefined") {
  					return function () {
  						return undefined;
  					};
  				}

  				// 'special' keypaths encode a value
  				if (keypath.isSpecial) {
  					value = keypath.value;
  					return function () {
  						return value;
  					};
  				}

  				return function () {
  					var value = _this.root.viewmodel.get(keypath, { noUnwrap: true, fullRootGet: true });
  					if (typeof value === "function") {
  						value = wrapFunction(value, _this.root);
  					}
  					return value;
  				};
  			});

  			signature = {
  				deps: this.keypaths.filter(isValidDependency),
  				getter: function () {
  					var args = valueGetters.map(call);
  					return fn.apply(null, args);
  				}
  			};

  			computation = this.root.viewmodel.compute(keypath, signature);
  		} else {
  			this.root.viewmodel.mark(keypath);
  		}
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		// TODO only bubble once, no matter how many references are affected by the rebind
  		this.refResolvers.forEach(function (r) {
  			return r.rebind(oldKeypath, newKeypath);
  		});
  	}
  };

  var Resolvers_ExpressionResolver = ExpressionResolver;

  function call(value) {
  	return value.call();
  }

  function getUniqueString(str, keypaths) {
  	// get string that is unique to this expression
  	return str.replace(/_([0-9]+)/g, function (match, $1) {
  		var keypath, value;

  		// make sure we're not replacing a non-keypath _[0-9]
  		if (+$1 >= keypaths.length) {
  			return "_" + $1;
  		}

  		keypath = keypaths[$1];

  		if (keypath === undefined) {
  			return "undefined";
  		}

  		if (keypath.isSpecial) {
  			value = keypath.value;
  			return typeof value === "number" ? value : "\"" + value + "\"";
  		}

  		return keypath.str;
  	});
  }

  function createExpressionKeypath(uniqueString) {
  	// Sanitize by removing any periods or square brackets. Otherwise
  	// we can't split the keypath into keys!
  	// Remove asterisks too, since they mess with pattern observers
  	return getKeypath("${" + uniqueString.replace(/[\.\[\]]/g, "-").replace(/\*/, "#MUL#") + "}");
  }

  function isValidDependency(keypath) {
  	return keypath !== undefined && keypath[0] !== "@";
  }

  function wrapFunction(fn, ractive) {
  	var wrapped, prop, key;

  	if (fn.__ractive_nowrap) {
  		return fn;
  	}

  	prop = "__ractive_" + ractive._guid;
  	wrapped = fn[prop];

  	if (wrapped) {
  		return wrapped;
  	} else if (/this/.test(fn.toString())) {
  		defineProperty(fn, prop, {
  			value: Resolvers_ExpressionResolver__bind.call(fn, ractive),
  			configurable: true
  		});

  		// Add properties/methods to wrapped function
  		for (key in fn) {
  			if (fn.hasOwnProperty(key)) {
  				fn[prop][key] = fn[key];
  			}
  		}

  		ractive._boundFunctions.push({
  			fn: fn,
  			prop: prop
  		});

  		return fn[prop];
  	}

  	defineProperty(fn, "__ractive_nowrap", {
  		value: fn
  	});

  	return fn.__ractive_nowrap;
  }

  var MemberResolver = function (template, resolver, parentFragment) {
  	var _this = this;

  	this.resolver = resolver;
  	this.root = resolver.root;
  	this.parentFragment = parentFragment;
  	this.viewmodel = resolver.root.viewmodel;

  	if (typeof template === "string") {
  		this.value = template;
  	}

  	// Simple reference?
  	else if (template.t === REFERENCE) {
  		this.refResolver = Resolvers_createReferenceResolver(this, template.n, function (keypath) {
  			_this.resolve(keypath);
  		});
  	}

  	// Otherwise we have an expression in its own right
  	else {
  		new Resolvers_ExpressionResolver(resolver, parentFragment, template, function (keypath) {
  			_this.resolve(keypath);
  		});
  	}
  };

  MemberResolver.prototype = {
  	resolve: function (keypath) {
  		if (this.keypath) {
  			this.viewmodel.unregister(this.keypath, this);
  		}

  		this.keypath = keypath;
  		this.value = this.viewmodel.get(keypath);

  		this.bind();

  		this.resolver.bubble();
  	},

  	bind: function () {
  		this.viewmodel.register(this.keypath, this);
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		if (this.refResolver) {
  			this.refResolver.rebind(oldKeypath, newKeypath);
  		}
  	},

  	setValue: function (value) {
  		this.value = value;
  		this.resolver.bubble();
  	},

  	unbind: function () {
  		if (this.keypath) {
  			this.viewmodel.unregister(this.keypath, this);
  		}

  		if (this.refResolver) {
  			this.refResolver.unbind();
  		}
  	},

  	forceResolution: function () {
  		if (this.refResolver) {
  			this.refResolver.forceResolution();
  		}
  	}
  };

  var ReferenceExpressionResolver_MemberResolver = MemberResolver;

  var ReferenceExpressionResolver = function (mustache, template, callback) {
  	var _this = this;

  	var ractive, ref, keypath, parentFragment;

  	this.parentFragment = parentFragment = mustache.parentFragment;
  	this.root = ractive = mustache.root;
  	this.mustache = mustache;

  	this.ref = ref = template.r;
  	this.callback = callback;

  	this.unresolved = [];

  	// Find base keypath
  	if (keypath = shared_resolveRef(ractive, ref, parentFragment)) {
  		this.base = keypath;
  	} else {
  		this.baseResolver = new Resolvers_ReferenceResolver(this, ref, function (keypath) {
  			_this.base = keypath;
  			_this.baseResolver = null;
  			_this.bubble();
  		});
  	}

  	// Find values for members, or mark them as unresolved
  	this.members = template.m.map(function (template) {
  		return new ReferenceExpressionResolver_MemberResolver(template, _this, parentFragment);
  	});

  	this.ready = true;
  	this.bubble(); // trigger initial resolution if possible
  };

  ReferenceExpressionResolver.prototype = {
  	getKeypath: function () {
  		var values = this.members.map(ReferenceExpressionResolver_ReferenceExpressionResolver__getValue);

  		if (!values.every(isDefined) || this.baseResolver) {
  			return null;
  		}

  		return this.base.join(values.join("."));
  	},

  	bubble: function () {
  		if (!this.ready || this.baseResolver) {
  			return;
  		}

  		this.callback(this.getKeypath());
  	},

  	unbind: function () {
  		this.members.forEach(methodCallers__unbind);
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		var changed;

  		if (this.base) {
  			var newBase = this.base.replace(oldKeypath, newKeypath);
  			if (newBase && newBase !== this.base) {
  				this.base = newBase;
  				changed = true;
  			}
  		}

  		this.members.forEach(function (members) {
  			if (members.rebind(oldKeypath, newKeypath)) {
  				changed = true;
  			}
  		});

  		if (changed) {
  			this.bubble();
  		}
  	},

  	forceResolution: function () {
  		if (this.baseResolver) {
  			this.base = getKeypath(this.ref);

  			this.baseResolver.unbind();
  			this.baseResolver = null;
  		}

  		this.members.forEach(forceResolution);
  		this.bubble();
  	}
  };

  function ReferenceExpressionResolver_ReferenceExpressionResolver__getValue(member) {
  	return member.value;
  }

  function isDefined(value) {
  	return value != undefined;
  }

  function forceResolution(member) {
  	member.forceResolution();
  }

  var ReferenceExpressionResolver_ReferenceExpressionResolver = ReferenceExpressionResolver;

  var Mustache_initialise = Mustache$init;
  function Mustache$init(mustache, options) {

  	var ref, parentFragment, template;

  	parentFragment = options.parentFragment;
  	template = options.template;

  	mustache.root = parentFragment.root;
  	mustache.parentFragment = parentFragment;
  	mustache.pElement = parentFragment.pElement;

  	mustache.template = options.template;
  	mustache.index = options.index || 0;
  	mustache.isStatic = options.template.s;

  	mustache.type = options.template.t;

  	mustache.registered = false;

  	// if this is a simple mustache, with a reference, we just need to resolve
  	// the reference to a keypath
  	if (ref = template.r) {
  		mustache.resolver = Resolvers_createReferenceResolver(mustache, ref, resolve);
  	}

  	// if it's an expression, we have a bit more work to do
  	if (options.template.x) {
  		mustache.resolver = new Resolvers_ExpressionResolver(mustache, parentFragment, options.template.x, resolveAndRebindChildren);
  	}

  	if (options.template.rx) {
  		mustache.resolver = new ReferenceExpressionResolver_ReferenceExpressionResolver(mustache, options.template.rx, resolveAndRebindChildren);
  	}

  	// Special case - inverted sections
  	if (mustache.template.n === SECTION_UNLESS && !mustache.hasOwnProperty("value")) {
  		mustache.setValue(undefined);
  	}

  	function resolve(keypath) {
  		mustache.resolve(keypath);
  	}

  	function resolveAndRebindChildren(newKeypath) {
  		var oldKeypath = mustache.keypath;

  		if (newKeypath != oldKeypath) {
  			mustache.resolve(newKeypath);

  			if (oldKeypath !== undefined) {
  				mustache.fragments && mustache.fragments.forEach(function (f) {
  					f.rebind(oldKeypath, newKeypath);
  				});
  			}
  		}
  	}
  }

  var Mustache_resolve = Mustache$resolve;

  function Mustache$resolve(keypath) {
  	var wasResolved, value, twowayBinding;

  	// 'Special' keypaths, e.g. @foo or @7, encode a value
  	if (keypath && keypath.isSpecial) {
  		this.keypath = keypath;
  		this.setValue(keypath.value);
  		return;
  	}

  	// If we resolved previously, we need to unregister
  	if (this.registered) {
  		// undefined or null
  		this.root.viewmodel.unregister(this.keypath, this);
  		this.registered = false;

  		wasResolved = true;
  	}

  	this.keypath = keypath;

  	// If the new keypath exists, we need to register
  	// with the viewmodel
  	if (keypath != undefined) {
  		// undefined or null
  		value = this.root.viewmodel.get(keypath);
  		this.root.viewmodel.register(keypath, this);

  		this.registered = true;
  	}

  	// Either way we need to queue up a render (`value`
  	// will be `undefined` if there's no keypath)
  	this.setValue(value);

  	// Two-way bindings need to point to their new target keypath
  	if (wasResolved && (twowayBinding = this.twowayBinding)) {
  		twowayBinding.rebound();
  	}
  }

  var Mustache_rebind = Mustache$rebind;

  function Mustache$rebind(oldKeypath, newKeypath) {
  	// Children first
  	if (this.fragments) {
  		this.fragments.forEach(function (f) {
  			return f.rebind(oldKeypath, newKeypath);
  		});
  	}

  	// Expression mustache?
  	if (this.resolver) {
  		this.resolver.rebind(oldKeypath, newKeypath);
  	}
  }

  var Mustache = {
  	getValue: Mustache_getValue,
  	init: Mustache_initialise,
  	resolve: Mustache_resolve,
  	rebind: Mustache_rebind
  };

  var Interpolator = function (options) {
  	this.type = INTERPOLATOR;
  	Mustache.init(this, options);
  };

  Interpolator.prototype = {
  	update: function () {
  		this.node.data = this.value == undefined ? "" : this.value;
  	},
  	resolve: Mustache.resolve,
  	rebind: Mustache.rebind,
  	detach: shared_detach,

  	unbind: shared_unbind,

  	render: function () {
  		if (!this.node) {
  			this.node = document.createTextNode(safeToStringValue(this.value));
  		}

  		return this.node;
  	},

  	unrender: function (shouldDestroy) {
  		if (shouldDestroy) {
  			detachNode(this.node);
  		}
  	},

  	getValue: Mustache.getValue,

  	// TEMP
  	setValue: function (value) {
  		var wrapper;

  		// TODO is there a better way to approach this?
  		if (this.keypath && (wrapper = this.root.viewmodel.wrapped[this.keypath.str])) {
  			value = wrapper.get();
  		}

  		if (!isEqual(value, this.value)) {
  			this.value = value;
  			this.parentFragment.bubble();

  			if (this.node) {
  				global_runloop.addView(this);
  			}
  		}
  	},

  	firstNode: function () {
  		return this.node;
  	},

  	toString: function (escape) {
  		var string = "" + safeToStringValue(this.value);
  		return escape ? escapeHtml(string) : string;
  	}
  };

  var items_Interpolator = Interpolator;

  var Section_prototype_bubble = Section$bubble;

  function Section$bubble() {
  	this.parentFragment.bubble();
  }

  var Section_prototype_detach = Section$detach;

  function Section$detach() {
  	var docFrag;

  	if (this.fragments.length === 1) {
  		return this.fragments[0].detach();
  	}

  	docFrag = document.createDocumentFragment();

  	this.fragments.forEach(function (item) {
  		docFrag.appendChild(item.detach());
  	});

  	return docFrag;
  }

  var find = Section$find;

  function Section$find(selector) {
  	var i, len, queryResult;

  	len = this.fragments.length;
  	for (i = 0; i < len; i += 1) {
  		if (queryResult = this.fragments[i].find(selector)) {
  			return queryResult;
  		}
  	}

  	return null;
  }

  var findAll = Section$findAll;

  function Section$findAll(selector, query) {
  	var i, len;

  	len = this.fragments.length;
  	for (i = 0; i < len; i += 1) {
  		this.fragments[i].findAll(selector, query);
  	}
  }

  var findAllComponents = Section$findAllComponents;

  function Section$findAllComponents(selector, query) {
  	var i, len;

  	len = this.fragments.length;
  	for (i = 0; i < len; i += 1) {
  		this.fragments[i].findAllComponents(selector, query);
  	}
  }

  var findComponent = Section$findComponent;

  function Section$findComponent(selector) {
  	var i, len, queryResult;

  	len = this.fragments.length;
  	for (i = 0; i < len; i += 1) {
  		if (queryResult = this.fragments[i].findComponent(selector)) {
  			return queryResult;
  		}
  	}

  	return null;
  }

  var findNextNode = Section$findNextNode;

  function Section$findNextNode(fragment) {
  	if (this.fragments[fragment.index + 1]) {
  		return this.fragments[fragment.index + 1].firstNode();
  	}

  	return this.parentFragment.findNextNode(this);
  }

  var firstNode = Section$firstNode;

  function Section$firstNode() {
  	var len, i, node;

  	if (len = this.fragments.length) {
  		for (i = 0; i < len; i += 1) {
  			if (node = this.fragments[i].firstNode()) {
  				return node;
  			}
  		}
  	}

  	return this.parentFragment.findNextNode(this);
  }

  var shuffle = Section$shuffle;

  function Section$shuffle(newIndices) {
  	var _this = this;

  	var parentFragment, firstChange, i, newLength, reboundFragments, fragmentOptions, fragment;

  	// short circuit any double-updates, and ensure that this isn't applied to
  	// non-list sections
  	if (this.shuffling || this.unbound || this.currentSubtype !== SECTION_EACH) {
  		return;
  	}

  	this.shuffling = true;
  	global_runloop.scheduleTask(function () {
  		return _this.shuffling = false;
  	});

  	parentFragment = this.parentFragment;

  	reboundFragments = [];

  	// TODO: need to update this
  	// first, rebind existing fragments
  	newIndices.forEach(function (newIndex, oldIndex) {
  		var fragment, by, oldKeypath, newKeypath, deps;

  		if (newIndex === oldIndex) {
  			reboundFragments[newIndex] = _this.fragments[oldIndex];
  			return;
  		}

  		fragment = _this.fragments[oldIndex];

  		if (firstChange === undefined) {
  			firstChange = oldIndex;
  		}

  		// does this fragment need to be torn down?
  		if (newIndex === -1) {
  			_this.fragmentsToUnrender.push(fragment);
  			fragment.unbind();
  			return;
  		}

  		// Otherwise, it needs to be rebound to a new index
  		by = newIndex - oldIndex;
  		oldKeypath = _this.keypath.join(oldIndex);
  		newKeypath = _this.keypath.join(newIndex);

  		fragment.index = newIndex;

  		// notify any registered index refs directly
  		if (deps = fragment.registeredIndexRefs) {
  			deps.forEach(shuffle__blindRebind);
  		}

  		fragment.rebind(oldKeypath, newKeypath);
  		reboundFragments[newIndex] = fragment;
  	});

  	newLength = this.root.viewmodel.get(this.keypath).length;

  	// If nothing changed with the existing fragments, then we start adding
  	// new fragments at the end...
  	if (firstChange === undefined) {
  		// ...unless there are no new fragments to add
  		if (this.length === newLength) {
  			return;
  		}

  		firstChange = this.length;
  	}

  	this.length = this.fragments.length = newLength;

  	if (this.rendered) {
  		global_runloop.addView(this);
  	}

  	// Prepare new fragment options
  	fragmentOptions = {
  		template: this.template.f,
  		root: this.root,
  		owner: this
  	};

  	// Add as many new fragments as we need to, or add back existing
  	// (detached) fragments
  	for (i = firstChange; i < newLength; i += 1) {
  		fragment = reboundFragments[i];

  		if (!fragment) {
  			this.fragmentsToCreate.push(i);
  		}

  		this.fragments[i] = fragment;
  	}
  }

  function shuffle__blindRebind(dep) {
  	// the keypath doesn't actually matter here as it won't have changed
  	dep.rebind("", "");
  }

  var prototype_rebind = function (oldKeypath, newKeypath) {
  	Mustache.rebind.call(this, oldKeypath, newKeypath);
  };

  var Section_prototype_render = Section$render;

  function Section$render() {
  	var _this = this;

  	this.docFrag = document.createDocumentFragment();

  	this.fragments.forEach(function (f) {
  		return _this.docFrag.appendChild(f.render());
  	});

  	this.renderedFragments = this.fragments.slice();
  	this.fragmentsToRender = [];

  	this.rendered = true;
  	return this.docFrag;
  }

  var setValue = Section$setValue;

  function Section$setValue(value) {
  	var _this = this;

  	var wrapper, fragmentOptions;

  	if (this.updating) {
  		// If a child of this section causes a re-evaluation - for example, an
  		// expression refers to a function that mutates the array that this
  		// section depends on - we'll end up with a double rendering bug (see
  		// https://github.com/ractivejs/ractive/issues/748). This prevents it.
  		return;
  	}

  	this.updating = true;

  	// with sections, we need to get the fake value if we have a wrapped object
  	if (this.keypath && (wrapper = this.root.viewmodel.wrapped[this.keypath.str])) {
  		value = wrapper.get();
  	}

  	// If any fragments are awaiting creation after a splice,
  	// this is the place to do it
  	if (this.fragmentsToCreate.length) {
  		fragmentOptions = {
  			template: this.template.f || [],
  			root: this.root,
  			pElement: this.pElement,
  			owner: this
  		};

  		this.fragmentsToCreate.forEach(function (index) {
  			var fragment;

  			fragmentOptions.context = _this.keypath.join(index);
  			fragmentOptions.index = index;

  			fragment = new virtualdom_Fragment(fragmentOptions);
  			_this.fragmentsToRender.push(_this.fragments[index] = fragment);
  		});

  		this.fragmentsToCreate.length = 0;
  	} else if (reevaluateSection(this, value)) {
  		this.bubble();

  		if (this.rendered) {
  			global_runloop.addView(this);
  		}
  	}

  	this.value = value;
  	this.updating = false;
  }

  function changeCurrentSubtype(section, value, obj) {
  	if (value === SECTION_EACH) {
  		// make sure ref type is up to date for key or value indices
  		if (section.indexRefs && section.indexRefs[0]) {
  			var ref = section.indexRefs[0];

  			// when switching flavors, make sure the section gets updated
  			if (obj && ref.t === "i" || !obj && ref.t === "k") {
  				// if switching from object to list, unbind all of the old fragments
  				if (!obj) {
  					section.length = 0;
  					section.fragmentsToUnrender = section.fragments.slice(0);
  					section.fragmentsToUnrender.forEach(function (f) {
  						return f.unbind();
  					});
  				}
  			}

  			ref.t = obj ? "k" : "i";
  		}
  	}

  	section.currentSubtype = value;
  }

  function reevaluateSection(section, value) {
  	var fragmentOptions = {
  		template: section.template.f || [],
  		root: section.root,
  		pElement: section.parentFragment.pElement,
  		owner: section
  	};

  	section.hasContext = true;

  	// If we already know the section type, great
  	// TODO can this be optimised? i.e. pick an reevaluateSection function during init
  	// and avoid doing this each time?
  	if (section.subtype) {
  		switch (section.subtype) {
  			case SECTION_IF:
  				section.hasContext = false;
  				return reevaluateConditionalSection(section, value, false, fragmentOptions);

  			case SECTION_UNLESS:
  				section.hasContext = false;
  				return reevaluateConditionalSection(section, value, true, fragmentOptions);

  			case SECTION_WITH:
  				return reevaluateContextSection(section, fragmentOptions);

  			case SECTION_IF_WITH:
  				return reevaluateConditionalContextSection(section, value, fragmentOptions);

  			case SECTION_EACH:
  				if (isObject(value)) {
  					changeCurrentSubtype(section, section.subtype, true);
  					return reevaluateListObjectSection(section, value, fragmentOptions);
  				}

  				// Fallthrough - if it's a conditional or an array we need to continue
  		}
  	}

  	// Otherwise we need to work out what sort of section we're dealing with
  	section.ordered = !!isArrayLike(value);

  	// Ordered list section
  	if (section.ordered) {
  		changeCurrentSubtype(section, SECTION_EACH, false);
  		return reevaluateListSection(section, value, fragmentOptions);
  	}

  	// Unordered list, or context
  	if (isObject(value) || typeof value === "function") {
  		// Index reference indicates section should be treated as a list
  		if (section.template.i) {
  			changeCurrentSubtype(section, SECTION_EACH, true);
  			return reevaluateListObjectSection(section, value, fragmentOptions);
  		}

  		// Otherwise, object provides context for contents
  		changeCurrentSubtype(section, SECTION_WITH, false);
  		return reevaluateContextSection(section, fragmentOptions);
  	}

  	// Conditional section
  	changeCurrentSubtype(section, SECTION_IF, false);
  	section.hasContext = false;
  	return reevaluateConditionalSection(section, value, false, fragmentOptions);
  }

  function reevaluateListSection(section, value, fragmentOptions) {
  	var i, length, fragment;

  	length = value.length;

  	if (length === section.length) {
  		// Nothing to do
  		return false;
  	}

  	// if the array is shorter than it was previously, remove items
  	if (length < section.length) {
  		section.fragmentsToUnrender = section.fragments.splice(length, section.length - length);
  		section.fragmentsToUnrender.forEach(methodCallers__unbind);
  	}

  	// otherwise...
  	else {
  		if (length > section.length) {
  			// add any new ones
  			for (i = section.length; i < length; i += 1) {
  				// append list item to context stack
  				fragmentOptions.context = section.keypath.join(i);
  				fragmentOptions.index = i;

  				fragment = new virtualdom_Fragment(fragmentOptions);
  				section.fragmentsToRender.push(section.fragments[i] = fragment);
  			}
  		}
  	}

  	section.length = length;
  	return true;
  }

  function reevaluateListObjectSection(section, value, fragmentOptions) {
  	var id, i, hasKey, fragment, changed, deps;

  	hasKey = section.hasKey || (section.hasKey = {});

  	// remove any fragments that should no longer exist
  	i = section.fragments.length;
  	while (i--) {
  		fragment = section.fragments[i];

  		if (!(fragment.key in value)) {
  			changed = true;

  			fragment.unbind();
  			section.fragmentsToUnrender.push(fragment);
  			section.fragments.splice(i, 1);

  			hasKey[fragment.key] = false;
  		}
  	}

  	// notify any dependents about changed indices
  	i = section.fragments.length;
  	while (i--) {
  		fragment = section.fragments[i];

  		if (fragment.index !== i) {
  			fragment.index = i;
  			if (deps = fragment.registeredIndexRefs) {
  				deps.forEach(setValue__blindRebind);
  			}
  		}
  	}

  	// add any that haven't been created yet
  	i = section.fragments.length;
  	for (id in value) {
  		if (!hasKey[id]) {
  			changed = true;

  			fragmentOptions.context = section.keypath.join(id);
  			fragmentOptions.key = id;
  			fragmentOptions.index = i++;

  			fragment = new virtualdom_Fragment(fragmentOptions);

  			section.fragmentsToRender.push(fragment);
  			section.fragments.push(fragment);
  			hasKey[id] = true;
  		}
  	}

  	section.length = section.fragments.length;
  	return changed;
  }

  function reevaluateConditionalContextSection(section, value, fragmentOptions) {
  	if (value) {
  		return reevaluateContextSection(section, fragmentOptions);
  	} else {
  		return removeSectionFragments(section);
  	}
  }

  function reevaluateContextSection(section, fragmentOptions) {
  	var fragment;

  	// ...then if it isn't rendered, render it, adding section.keypath to the context stack
  	// (if it is already rendered, then any children dependent on the context stack
  	// will update themselves without any prompting)
  	if (!section.length) {
  		// append this section to the context stack
  		fragmentOptions.context = section.keypath;
  		fragmentOptions.index = 0;

  		fragment = new virtualdom_Fragment(fragmentOptions);

  		section.fragmentsToRender.push(section.fragments[0] = fragment);
  		section.length = 1;

  		return true;
  	}
  }

  function reevaluateConditionalSection(section, value, inverted, fragmentOptions) {
  	var doRender, emptyArray, emptyObject, fragment, name;

  	emptyArray = isArrayLike(value) && value.length === 0;
  	emptyObject = false;
  	if (!isArrayLike(value) && isObject(value)) {
  		emptyObject = true;
  		for (name in value) {
  			emptyObject = false;
  			break;
  		}
  	}

  	if (inverted) {
  		doRender = emptyArray || emptyObject || !value;
  	} else {
  		doRender = value && !emptyArray && !emptyObject;
  	}

  	if (doRender) {
  		if (!section.length) {
  			// no change to context stack
  			fragmentOptions.index = 0;

  			fragment = new virtualdom_Fragment(fragmentOptions);
  			section.fragmentsToRender.push(section.fragments[0] = fragment);
  			section.length = 1;

  			return true;
  		}

  		if (section.length > 1) {
  			section.fragmentsToUnrender = section.fragments.splice(1);
  			section.fragmentsToUnrender.forEach(methodCallers__unbind);

  			return true;
  		}
  	} else {
  		return removeSectionFragments(section);
  	}
  }

  function removeSectionFragments(section) {
  	if (section.length) {
  		section.fragmentsToUnrender = section.fragments.splice(0, section.fragments.length).filter(isRendered);
  		section.fragmentsToUnrender.forEach(methodCallers__unbind);
  		section.length = section.fragmentsToRender.length = 0;
  		return true;
  	}
  }

  function isRendered(fragment) {
  	return fragment.rendered;
  }

  function setValue__blindRebind(dep) {
  	// the keypath doesn't actually matter here as it won't have changed
  	dep.rebind("", "");
  }

  var prototype_toString = Section$toString;

  function Section$toString(escape) {
  	var str, i, len;

  	str = "";

  	i = 0;
  	len = this.length;

  	for (i = 0; i < len; i += 1) {
  		str += this.fragments[i].toString(escape);
  	}

  	return str;
  }

  var prototype_unbind = Section$unbind;
  function Section$unbind() {
  	var _this = this;

  	this.fragments.forEach(methodCallers__unbind);
  	this.fragmentsToRender.forEach(function (f) {
  		return removeFromArray(_this.fragments, f);
  	});
  	this.fragmentsToRender = [];
  	shared_unbind.call(this);

  	this.length = 0;
  	this.unbound = true;
  }

  var prototype_unrender = Section$unrender;

  function Section$unrender(shouldDestroy) {
  	this.fragments.forEach(shouldDestroy ? unrenderAndDestroy : prototype_unrender__unrender);
  	this.renderedFragments = [];
  	this.rendered = false;
  }

  function unrenderAndDestroy(fragment) {
  	fragment.unrender(true);
  }

  function prototype_unrender__unrender(fragment) {
  	fragment.unrender(false);
  }

  var prototype_update = Section$update;

  function Section$update() {
  	var fragment, renderIndex, renderedFragments, anchor, target, i, len;

  	// `this.renderedFragments` is in the order of the previous render.
  	// If fragments have shuffled about, this allows us to quickly
  	// reinsert them in the correct place
  	renderedFragments = this.renderedFragments;

  	// Remove fragments that have been marked for destruction
  	while (fragment = this.fragmentsToUnrender.pop()) {
  		fragment.unrender(true);
  		renderedFragments.splice(renderedFragments.indexOf(fragment), 1);
  	}

  	// Render new fragments (but don't insert them yet)
  	while (fragment = this.fragmentsToRender.shift()) {
  		fragment.render();
  	}

  	if (this.rendered) {
  		target = this.parentFragment.getNode();
  	}

  	len = this.fragments.length;
  	for (i = 0; i < len; i += 1) {
  		fragment = this.fragments[i];
  		renderIndex = renderedFragments.indexOf(fragment, i); // search from current index - it's guaranteed to be the same or higher

  		if (renderIndex === i) {
  			// already in the right place. insert accumulated nodes (if any) and carry on
  			if (this.docFrag.childNodes.length) {
  				anchor = fragment.firstNode();
  				target.insertBefore(this.docFrag, anchor);
  			}

  			continue;
  		}

  		this.docFrag.appendChild(fragment.detach());

  		// update renderedFragments
  		if (renderIndex !== -1) {
  			renderedFragments.splice(renderIndex, 1);
  		}
  		renderedFragments.splice(i, 0, fragment);
  	}

  	if (this.rendered && this.docFrag.childNodes.length) {
  		anchor = this.parentFragment.findNextNode(this);
  		target.insertBefore(this.docFrag, anchor);
  	}

  	// Save the rendering order for next time
  	this.renderedFragments = this.fragments.slice();
  }

  var Section = function (options) {
  	this.type = SECTION;
  	this.subtype = this.currentSubtype = options.template.n;
  	this.inverted = this.subtype === SECTION_UNLESS;

  	this.pElement = options.pElement;

  	this.fragments = [];
  	this.fragmentsToCreate = [];
  	this.fragmentsToRender = [];
  	this.fragmentsToUnrender = [];

  	if (options.template.i) {
  		this.indexRefs = options.template.i.split(",").map(function (k, i) {
  			return { n: k, t: i === 0 ? "k" : "i" };
  		});
  	}

  	this.renderedFragments = [];

  	this.length = 0; // number of times this section is rendered

  	Mustache.init(this, options);
  };

  Section.prototype = {
  	bubble: Section_prototype_bubble,
  	detach: Section_prototype_detach,
  	find: find,
  	findAll: findAll,
  	findAllComponents: findAllComponents,
  	findComponent: findComponent,
  	findNextNode: findNextNode,
  	firstNode: firstNode,
  	getIndexRef: function (name) {
  		if (this.indexRefs) {
  			var i = this.indexRefs.length;
  			while (i--) {
  				var ref = this.indexRefs[i];
  				if (ref.n === name) {
  					return ref;
  				}
  			}
  		}
  	},
  	getValue: Mustache.getValue,
  	shuffle: shuffle,
  	rebind: prototype_rebind,
  	render: Section_prototype_render,
  	resolve: Mustache.resolve,
  	setValue: setValue,
  	toString: prototype_toString,
  	unbind: prototype_unbind,
  	unrender: prototype_unrender,
  	update: prototype_update
  };

  var _Section = Section;

  var Triple_prototype_detach = Triple$detach;

  function Triple$detach() {
  	var len, i;

  	if (this.docFrag) {
  		len = this.nodes.length;
  		for (i = 0; i < len; i += 1) {
  			this.docFrag.appendChild(this.nodes[i]);
  		}

  		return this.docFrag;
  	}
  }

  var Triple_prototype_find = Triple$find;
  function Triple$find(selector) {
  	var i, len, node, queryResult;

  	len = this.nodes.length;
  	for (i = 0; i < len; i += 1) {
  		node = this.nodes[i];

  		if (node.nodeType !== 1) {
  			continue;
  		}

  		if (matches(node, selector)) {
  			return node;
  		}

  		if (queryResult = node.querySelector(selector)) {
  			return queryResult;
  		}
  	}

  	return null;
  }

  var Triple_prototype_findAll = Triple$findAll;
  function Triple$findAll(selector, queryResult) {
  	var i, len, node, queryAllResult, numNodes, j;

  	len = this.nodes.length;
  	for (i = 0; i < len; i += 1) {
  		node = this.nodes[i];

  		if (node.nodeType !== 1) {
  			continue;
  		}

  		if (matches(node, selector)) {
  			queryResult.push(node);
  		}

  		if (queryAllResult = node.querySelectorAll(selector)) {
  			numNodes = queryAllResult.length;
  			for (j = 0; j < numNodes; j += 1) {
  				queryResult.push(queryAllResult[j]);
  			}
  		}
  	}
  }

  var Triple_prototype_firstNode = Triple$firstNode;

  function Triple$firstNode() {
  	if (this.rendered && this.nodes[0]) {
  		return this.nodes[0];
  	}

  	return this.parentFragment.findNextNode(this);
  }

  var elementCache = {},
      ieBug,
      ieBlacklist;

  try {
  	createElement("table").innerHTML = "foo";
  } catch (err) {
  	ieBug = true;

  	ieBlacklist = {
  		TABLE: ["<table class=\"x\">", "</table>"],
  		THEAD: ["<table><thead class=\"x\">", "</thead></table>"],
  		TBODY: ["<table><tbody class=\"x\">", "</tbody></table>"],
  		TR: ["<table><tr class=\"x\">", "</tr></table>"],
  		SELECT: ["<select class=\"x\">", "</select>"]
  	};
  }

  var insertHtml = function (html, node, docFrag) {
  	var container,
  	    nodes = [],
  	    wrapper,
  	    selectedOption,
  	    child,
  	    i;

  	// render 0 and false
  	if (html != null && html !== "") {
  		if (ieBug && (wrapper = ieBlacklist[node.tagName])) {
  			container = element("DIV");
  			container.innerHTML = wrapper[0] + html + wrapper[1];
  			container = container.querySelector(".x");

  			if (container.tagName === "SELECT") {
  				selectedOption = container.options[container.selectedIndex];
  			}
  		} else if (node.namespaceURI === namespaces.svg) {
  			container = element("DIV");
  			container.innerHTML = "<svg class=\"x\">" + html + "</svg>";
  			container = container.querySelector(".x");
  		} else {
  			container = element(node.tagName);
  			container.innerHTML = html;

  			if (container.tagName === "SELECT") {
  				selectedOption = container.options[container.selectedIndex];
  			}
  		}

  		while (child = container.firstChild) {
  			nodes.push(child);
  			docFrag.appendChild(child);
  		}

  		// This is really annoying. Extracting <option> nodes from the
  		// temporary container <select> causes the remaining ones to
  		// become selected. So now we have to deselect them. IE8, you
  		// amaze me. You really do
  		// ...and now Chrome too
  		if (node.tagName === "SELECT") {
  			i = nodes.length;
  			while (i--) {
  				if (nodes[i] !== selectedOption) {
  					nodes[i].selected = false;
  				}
  			}
  		}
  	}

  	return nodes;
  };

  function element(tagName) {
  	return elementCache[tagName] || (elementCache[tagName] = createElement(tagName));
  }

  var helpers_updateSelect = updateSelect;

  function updateSelect(parentElement) {
  	var selectedOptions, option, value;

  	if (!parentElement || parentElement.name !== "select" || !parentElement.binding) {
  		return;
  	}

  	selectedOptions = toArray(parentElement.node.options).filter(isSelected);

  	// If one of them had a `selected` attribute, we need to sync
  	// the model to the view
  	if (parentElement.getAttribute("multiple")) {
  		value = selectedOptions.map(function (o) {
  			return o.value;
  		});
  	} else if (option = selectedOptions[0]) {
  		value = option.value;
  	}

  	if (value !== undefined) {
  		parentElement.binding.setValue(value);
  	}

  	parentElement.bubble();
  }

  function isSelected(option) {
  	return option.selected;
  }

  var Triple_prototype_render = Triple$render;
  function Triple$render() {
  	if (this.rendered) {
  		throw new Error("Attempted to render an item that was already rendered");
  	}

  	this.docFrag = document.createDocumentFragment();
  	this.nodes = insertHtml(this.value, this.parentFragment.getNode(), this.docFrag);

  	// Special case - we're inserting the contents of a <select>
  	helpers_updateSelect(this.pElement);

  	this.rendered = true;
  	return this.docFrag;
  }

  var prototype_setValue = Triple$setValue;
  function Triple$setValue(value) {
  	var wrapper;

  	// TODO is there a better way to approach this?
  	if (wrapper = this.root.viewmodel.wrapped[this.keypath.str]) {
  		value = wrapper.get();
  	}

  	if (value !== this.value) {
  		this.value = value;
  		this.parentFragment.bubble();

  		if (this.rendered) {
  			global_runloop.addView(this);
  		}
  	}
  }

  var Triple_prototype_toString = Triple$toString;
  function Triple$toString() {
  	return this.value != undefined ? decodeCharacterReferences("" + this.value) : "";
  }

  var Triple_prototype_unrender = Triple$unrender;
  function Triple$unrender(shouldDestroy) {
  	if (this.rendered && shouldDestroy) {
  		this.nodes.forEach(detachNode);
  		this.rendered = false;
  	}

  	// TODO update live queries
  }

  var Triple_prototype_update = Triple$update;
  function Triple$update() {
  	var node, parentNode;

  	if (!this.rendered) {
  		return;
  	}

  	// Remove existing nodes
  	while (this.nodes && this.nodes.length) {
  		node = this.nodes.pop();
  		node.parentNode.removeChild(node);
  	}

  	// Insert new nodes
  	parentNode = this.parentFragment.getNode();

  	this.nodes = insertHtml(this.value, parentNode, this.docFrag);
  	parentNode.insertBefore(this.docFrag, this.parentFragment.findNextNode(this));

  	// Special case - we're inserting the contents of a <select>
  	helpers_updateSelect(this.pElement);
  }

  var Triple = function (options) {
  	this.type = TRIPLE;
  	Mustache.init(this, options);
  };

  Triple.prototype = {
  	detach: Triple_prototype_detach,
  	find: Triple_prototype_find,
  	findAll: Triple_prototype_findAll,
  	firstNode: Triple_prototype_firstNode,
  	getValue: Mustache.getValue,
  	rebind: Mustache.rebind,
  	render: Triple_prototype_render,
  	resolve: Mustache.resolve,
  	setValue: prototype_setValue,
  	toString: Triple_prototype_toString,
  	unbind: shared_unbind,
  	unrender: Triple_prototype_unrender,
  	update: Triple_prototype_update
  };

  var _Triple = Triple;

  var Element_prototype_bubble = function () {
  	this.parentFragment.bubble();
  };

  var Element_prototype_detach = Element$detach;

  function Element$detach() {
  	var node = this.node,
  	    parentNode;

  	if (node) {
  		// need to check for parent node - DOM may have been altered
  		// by something other than Ractive! e.g. jQuery UI...
  		if (parentNode = node.parentNode) {
  			parentNode.removeChild(node);
  		}

  		return node;
  	}
  }

  var Element_prototype_find = function (selector) {
  	if (!this.node) {
  		// this element hasn't been rendered yet
  		return null;
  	}

  	if (matches(this.node, selector)) {
  		return this.node;
  	}

  	if (this.fragment && this.fragment.find) {
  		return this.fragment.find(selector);
  	}
  };

  var Element_prototype_findAll = function (selector, query) {
  	// Add this node to the query, if applicable, and register the
  	// query on this element
  	if (query._test(this, true) && query.live) {
  		(this.liveQueries || (this.liveQueries = [])).push(query);
  	}

  	if (this.fragment) {
  		this.fragment.findAll(selector, query);
  	}
  };

  var Element_prototype_findAllComponents = function (selector, query) {
  	if (this.fragment) {
  		this.fragment.findAllComponents(selector, query);
  	}
  };

  var Element_prototype_findComponent = function (selector) {
  	if (this.fragment) {
  		return this.fragment.findComponent(selector);
  	}
  };

  var Element_prototype_findNextNode = Element$findNextNode;

  function Element$findNextNode() {
  	return null;
  }

  var Element_prototype_firstNode = Element$firstNode;

  function Element$firstNode() {
  	return this.node;
  }

  var getAttribute = Element$getAttribute;

  function Element$getAttribute(name) {
  	if (!this.attributes || !this.attributes[name]) {
  		return;
  	}

  	return this.attributes[name].value;
  }

  var truthy = /^true|on|yes|1$/i;
  var processBindingAttributes__isNumeric = /^[0-9]+$/;

  var processBindingAttributes = function (element, template) {
  	var val, attrs, attributes;

  	attributes = template.a || {};
  	attrs = {};

  	// attributes that are present but don't have a value (=)
  	// will be set to the number 0, which we condider to be true
  	// the string '0', however is false

  	val = attributes.twoway;
  	if (val !== undefined) {
  		attrs.twoway = val === 0 || truthy.test(val);
  	}

  	val = attributes.lazy;
  	if (val !== undefined) {
  		// check for timeout value
  		if (val !== 0 && processBindingAttributes__isNumeric.test(val)) {
  			attrs.lazy = parseInt(val);
  		} else {
  			attrs.lazy = val === 0 || truthy.test(val);
  		}
  	}

  	return attrs;
  };

  var Attribute_prototype_bubble = Attribute$bubble;
  function Attribute$bubble() {
  	var value = this.useProperty || !this.rendered ? this.fragment.getValue() : this.fragment.toString();

  	// TODO this can register the attribute multiple times (see render test
  	// 'Attribute with nested mustaches')
  	if (!isEqual(value, this.value)) {

  		// Need to clear old id from ractive.nodes
  		if (this.name === "id" && this.value) {
  			delete this.root.nodes[this.value];
  		}

  		this.value = value;

  		if (this.name === "value" && this.node) {
  			// We need to store the value on the DOM like this so we
  			// can retrieve it later without it being coerced to a string
  			this.node._ractive.value = value;
  		}

  		if (this.rendered) {
  			global_runloop.addView(this);
  		}
  	}
  }

  var svgCamelCaseElements, svgCamelCaseAttributes, createMap, map;
  svgCamelCaseElements = "altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath vkern".split(" ");
  svgCamelCaseAttributes = "attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits contentScriptType contentStyleType diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan".split(" ");

  createMap = function (items) {
  	var map = {},
  	    i = items.length;
  	while (i--) {
  		map[items[i].toLowerCase()] = items[i];
  	}
  	return map;
  };

  map = createMap(svgCamelCaseElements.concat(svgCamelCaseAttributes));

  var enforceCase = function (elementName) {
  	var lowerCaseElementName = elementName.toLowerCase();
  	return map[lowerCaseElementName] || lowerCaseElementName;
  };

  var determineNameAndNamespace = function (attribute, name) {
  	var colonIndex, namespacePrefix;

  	// are we dealing with a namespaced attribute, e.g. xlink:href?
  	colonIndex = name.indexOf(":");
  	if (colonIndex !== -1) {

  		// looks like we are, yes...
  		namespacePrefix = name.substr(0, colonIndex);

  		// ...unless it's a namespace *declaration*, which we ignore (on the assumption
  		// that only valid namespaces will be used)
  		if (namespacePrefix !== "xmlns") {
  			name = name.substring(colonIndex + 1);

  			attribute.name = enforceCase(name);
  			attribute.namespace = namespaces[namespacePrefix.toLowerCase()];
  			attribute.namespacePrefix = namespacePrefix;

  			if (!attribute.namespace) {
  				throw "Unknown namespace (\"" + namespacePrefix + "\")";
  			}

  			return;
  		}
  	}

  	// SVG attribute names are case sensitive
  	attribute.name = attribute.element.namespace !== namespaces.html ? enforceCase(name) : name;
  };

  var helpers_getInterpolator = getInterpolator;
  function getInterpolator(attribute) {
  	var items = attribute.fragment.items;

  	if (items.length !== 1) {
  		return;
  	}

  	if (items[0].type === INTERPOLATOR) {
  		return items[0];
  	}
  }

  var prototype_init = Attribute$init;
  function Attribute$init(options) {
  	this.type = ATTRIBUTE;
  	this.element = options.element;
  	this.root = options.root;

  	determineNameAndNamespace(this, options.name);
  	this.isBoolean = booleanAttributes.test(this.name);

  	// if it's an empty attribute, or just a straight key-value pair, with no
  	// mustache shenanigans, set the attribute accordingly and go home
  	if (!options.value || typeof options.value === "string") {
  		this.value = this.isBoolean ? true : options.value || "";
  		return;
  	}

  	// otherwise we need to do some work

  	// share parentFragment with parent element
  	this.parentFragment = this.element.parentFragment;

  	this.fragment = new virtualdom_Fragment({
  		template: options.value,
  		root: this.root,
  		owner: this
  	});

  	// TODO can we use this.fragment.toString() in some cases? It's quicker
  	this.value = this.fragment.getValue();

  	// Store a reference to this attribute's interpolator, if its fragment
  	// takes the form `{{foo}}`. This is necessary for two-way binding and
  	// for correctly rendering HTML later
  	this.interpolator = helpers_getInterpolator(this);
  	this.isBindable = !!this.interpolator && !this.interpolator.isStatic;

  	// mark as ready
  	this.ready = true;
  }

  var Attribute_prototype_rebind = Attribute$rebind;

  function Attribute$rebind(oldKeypath, newKeypath) {
  	if (this.fragment) {
  		this.fragment.rebind(oldKeypath, newKeypath);
  	}
  }

  var Attribute_prototype_render = Attribute$render;
  var propertyNames = {
  	"accept-charset": "acceptCharset",
  	accesskey: "accessKey",
  	bgcolor: "bgColor",
  	"class": "className",
  	codebase: "codeBase",
  	colspan: "colSpan",
  	contenteditable: "contentEditable",
  	datetime: "dateTime",
  	dirname: "dirName",
  	"for": "htmlFor",
  	"http-equiv": "httpEquiv",
  	ismap: "isMap",
  	maxlength: "maxLength",
  	novalidate: "noValidate",
  	pubdate: "pubDate",
  	readonly: "readOnly",
  	rowspan: "rowSpan",
  	tabindex: "tabIndex",
  	usemap: "useMap"
  };
  function Attribute$render(node) {
  	var propertyName;

  	this.node = node;

  	// should we use direct property access, or setAttribute?
  	if (!node.namespaceURI || node.namespaceURI === namespaces.html) {
  		propertyName = propertyNames[this.name] || this.name;

  		if (node[propertyName] !== undefined) {
  			this.propertyName = propertyName;
  		}

  		// is attribute a boolean attribute or 'value'? If so we're better off doing e.g.
  		// node.selected = true rather than node.setAttribute( 'selected', '' )
  		if (this.isBoolean || this.isTwoway) {
  			this.useProperty = true;
  		}

  		if (propertyName === "value") {
  			node._ractive.value = this.value;
  		}
  	}

  	this.rendered = true;
  	this.update();
  }

  var Attribute_prototype_toString = Attribute$toString;

  function Attribute$toString() {
  	var _ref = this;

  	var name = _ref.name;
  	var namespacePrefix = _ref.namespacePrefix;
  	var value = _ref.value;
  	var interpolator = _ref.interpolator;
  	var fragment = _ref.fragment;

  	// Special case - select and textarea values (should not be stringified)
  	if (name === "value" && (this.element.name === "select" || this.element.name === "textarea")) {
  		return;
  	}

  	// Special case - content editable
  	if (name === "value" && this.element.getAttribute("contenteditable") !== undefined) {
  		return;
  	}

  	// Special case - radio names
  	if (name === "name" && this.element.name === "input" && interpolator) {
  		return "name={{" + (interpolator.keypath.str || interpolator.ref) + "}}";
  	}

  	// Boolean attributes
  	if (this.isBoolean) {
  		return value ? name : "";
  	}

  	if (fragment) {
  		// special case - this catches undefined/null values (#1211)
  		if (fragment.items.length === 1 && fragment.items[0].value == null) {
  			return "";
  		}

  		value = fragment.toString();
  	}

  	if (namespacePrefix) {
  		name = namespacePrefix + ":" + name;
  	}

  	return value ? name + "=\"" + Attribute_prototype_toString__escape(value) + "\"" : name;
  }

  function Attribute_prototype_toString__escape(value) {
  	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var Attribute_prototype_unbind = Attribute$unbind;

  function Attribute$unbind() {
  	// ignore non-dynamic attributes
  	if (this.fragment) {
  		this.fragment.unbind();
  	}

  	if (this.name === "id") {
  		delete this.root.nodes[this.value];
  	}
  }

  var updateSelectValue = Attribute$updateSelect;

  function Attribute$updateSelect() {
  	var value = this.value,
  	    options,
  	    option,
  	    optionValue,
  	    i;

  	if (!this.locked) {
  		this.node._ractive.value = value;

  		options = this.node.options;
  		i = options.length;

  		while (i--) {
  			option = options[i];
  			optionValue = option._ractive ? option._ractive.value : option.value; // options inserted via a triple don't have _ractive

  			if (optionValue == value) {
  				// double equals as we may be comparing numbers with strings
  				option.selected = true;
  				break;
  			}
  		}
  	}

  	// if we're still here, it means the new value didn't match any of the options...
  	// TODO figure out what to do in this situation
  }

  var updateMultipleSelectValue = Attribute$updateMultipleSelect;
  function Attribute$updateMultipleSelect() {
  	var value = this.value,
  	    options,
  	    i,
  	    option,
  	    optionValue;

  	if (!isArray(value)) {
  		value = [value];
  	}

  	options = this.node.options;
  	i = options.length;

  	while (i--) {
  		option = options[i];
  		optionValue = option._ractive ? option._ractive.value : option.value; // options inserted via a triple don't have _ractive
  		option.selected = arrayContains(value, optionValue);
  	}
  }

  var updateRadioName = Attribute$updateRadioName;

  function Attribute$updateRadioName() {
  	var _ref = this;

  	var node = _ref.node;
  	var value = _ref.value;

  	node.checked = value == node._ractive.value;
  }

  var updateRadioValue = Attribute$updateRadioValue;
  function Attribute$updateRadioValue() {
  	var wasChecked,
  	    node = this.node,
  	    binding,
  	    bindings,
  	    i;

  	wasChecked = node.checked;

  	node.value = this.element.getAttribute("value");
  	node.checked = this.element.getAttribute("value") === this.element.getAttribute("name");

  	// This is a special case - if the input was checked, and the value
  	// changed so that it's no longer checked, the twoway binding is
  	// most likely out of date. To fix it we have to jump through some
  	// hoops... this is a little kludgy but it works
  	if (wasChecked && !node.checked && this.element.binding) {
  		bindings = this.element.binding.siblings;

  		if (i = bindings.length) {
  			while (i--) {
  				binding = bindings[i];

  				if (!binding.element.node) {
  					// this is the initial render, siblings are still rendering!
  					// we'll come back later...
  					return;
  				}

  				if (binding.element.node.checked) {
  					global_runloop.addRactive(binding.root);
  					return binding.handleChange();
  				}
  			}

  			this.root.viewmodel.set(binding.keypath, undefined);
  		}
  	}
  }

  var updateCheckboxName = Attribute$updateCheckboxName;
  function Attribute$updateCheckboxName() {
  	var _ref = this;

  	var element = _ref.element;
  	var node = _ref.node;
  	var value = _ref.value;var binding = element.binding;var valueAttribute;var i;

  	valueAttribute = element.getAttribute("value");

  	if (!isArray(value)) {
  		binding.isChecked = node.checked = value == valueAttribute;
  	} else {
  		i = value.length;
  		while (i--) {
  			if (valueAttribute == value[i]) {
  				binding.isChecked = node.checked = true;
  				return;
  			}
  		}
  		binding.isChecked = node.checked = false;
  	}
  }

  var updateClassName = Attribute$updateClassName;
  function Attribute$updateClassName() {
  	this.node.className = safeToStringValue(this.value);
  }

  var updateIdAttribute = Attribute$updateIdAttribute;

  function Attribute$updateIdAttribute() {
  	var _ref = this;

  	var node = _ref.node;
  	var value = _ref.value;

  	this.root.nodes[value] = node;
  	node.id = value;
  }

  var updateIEStyleAttribute = Attribute$updateIEStyleAttribute;

  function Attribute$updateIEStyleAttribute() {
  	var node, value;

  	node = this.node;
  	value = this.value;

  	if (value === undefined) {
  		value = "";
  	}

  	node.style.setAttribute("cssText", value);
  }

  var updateContentEditableValue = Attribute$updateContentEditableValue;

  function Attribute$updateContentEditableValue() {
  	var value = this.value;

  	if (value === undefined) {
  		value = "";
  	}

  	if (!this.locked) {
  		this.node.innerHTML = value;
  	}
  }

  var updateValue = Attribute$updateValue;

  function Attribute$updateValue() {
  	var _ref = this;

  	var node = _ref.node;
  	var value = _ref.value;

  	// store actual value, so it doesn't get coerced to a string
  	node._ractive.value = value;

  	// with two-way binding, only update if the change wasn't initiated by the user
  	// otherwise the cursor will often be sent to the wrong place
  	if (!this.locked) {
  		node.value = value == undefined ? "" : value;
  	}
  }

  var updateBoolean = Attribute$updateBooleanAttribute;

  function Attribute$updateBooleanAttribute() {
  	// with two-way binding, only update if the change wasn't initiated by the user
  	// otherwise the cursor will often be sent to the wrong place
  	if (!this.locked) {
  		this.node[this.propertyName] = this.value;
  	}
  }

  var updateEverythingElse = Attribute$updateEverythingElse;

  function Attribute$updateEverythingElse() {
  	var _ref = this;

  	var node = _ref.node;
  	var namespace = _ref.namespace;
  	var name = _ref.name;
  	var value = _ref.value;
  	var fragment = _ref.fragment;

  	if (namespace) {
  		node.setAttributeNS(namespace, name, (fragment || value).toString());
  	} else if (!this.isBoolean) {
  		if (value == null) {
  			node.removeAttribute(name);
  		} else {
  			node.setAttribute(name, (fragment || value).toString());
  		}
  	}

  	// Boolean attributes - truthy becomes '', falsy means 'remove attribute'
  	else {
  		if (value) {
  			node.setAttribute(name, "");
  		} else {
  			node.removeAttribute(name);
  		}
  	}
  }

  // There are a few special cases when it comes to updating attributes. For this reason,
  // the prototype .update() method points to this method, which waits until the
  // attribute has finished initialising, then replaces the prototype method with a more
  // suitable one. That way, we save ourselves doing a bunch of tests on each call
  var Attribute_prototype_update = Attribute$update;
  function Attribute$update() {
  	var _ref = this;

  	var name = _ref.name;
  	var element = _ref.element;
  	var node = _ref.node;var type;var updateMethod;

  	if (name === "id") {
  		updateMethod = updateIdAttribute;
  	} else if (name === "value") {
  		// special case - selects
  		if (element.name === "select" && name === "value") {
  			updateMethod = element.getAttribute("multiple") ? updateMultipleSelectValue : updateSelectValue;
  		} else if (element.name === "textarea") {
  			updateMethod = updateValue;
  		}

  		// special case - contenteditable
  		else if (element.getAttribute("contenteditable") != null) {
  			updateMethod = updateContentEditableValue;
  		}

  		// special case - <input>
  		else if (element.name === "input") {
  			type = element.getAttribute("type");

  			// type='file' value='{{fileList}}'>
  			if (type === "file") {
  				updateMethod = noop; // read-only
  			}

  			// type='radio' name='{{twoway}}'
  			else if (type === "radio" && element.binding && element.binding.name === "name") {
  				updateMethod = updateRadioValue;
  			} else {
  				updateMethod = updateValue;
  			}
  		}
  	}

  	// special case - <input type='radio' name='{{twoway}}' value='foo'>
  	else if (this.isTwoway && name === "name") {
  		if (node.type === "radio") {
  			updateMethod = updateRadioName;
  		} else if (node.type === "checkbox") {
  			updateMethod = updateCheckboxName;
  		}
  	}

  	// special case - style attributes in Internet Exploder
  	else if (name === "style" && node.style.setAttribute) {
  		updateMethod = updateIEStyleAttribute;
  	}

  	// special case - class names. IE fucks things up, again
  	else if (name === "class" && (!node.namespaceURI || node.namespaceURI === namespaces.html)) {
  		updateMethod = updateClassName;
  	} else if (this.useProperty) {
  		updateMethod = updateBoolean;
  	}

  	if (!updateMethod) {
  		updateMethod = updateEverythingElse;
  	}

  	this.update = updateMethod;
  	this.update();
  }

  var Attribute = function (options) {
  	this.init(options);
  };

  Attribute.prototype = {
  	bubble: Attribute_prototype_bubble,
  	init: prototype_init,
  	rebind: Attribute_prototype_rebind,
  	render: Attribute_prototype_render,
  	toString: Attribute_prototype_toString,
  	unbind: Attribute_prototype_unbind,
  	update: Attribute_prototype_update
  };

  var _Attribute = Attribute;

  var createAttributes = function (element, attributes) {
  	var name,
  	    attribute,
  	    result = [];

  	for (name in attributes) {
  		// skip binding attributes
  		if (name === "twoway" || name === "lazy") {
  			continue;
  		}

  		if (attributes.hasOwnProperty(name)) {
  			attribute = new _Attribute({
  				element: element,
  				name: name,
  				value: attributes[name],
  				root: element.root
  			});

  			result[name] = attribute;

  			if (name !== "value") {
  				result.push(attribute);
  			}
  		}
  	}

  	// value attribute goes last. This is because it
  	// may get clamped on render otherwise, e.g. in
  	// `<input type='range' value='999' min='0' max='1000'>`
  	// since default max is 100
  	if (attribute = result.value) {
  		result.push(attribute);
  	}

  	return result;
  };

  var _ConditionalAttribute__div;

  if (typeof document !== "undefined") {
  	_ConditionalAttribute__div = createElement("div");
  }

  var ConditionalAttribute = function (element, template) {
  	this.element = element;
  	this.root = element.root;
  	this.parentFragment = element.parentFragment;

  	this.attributes = [];

  	this.fragment = new virtualdom_Fragment({
  		root: element.root,
  		owner: this,
  		template: [template]
  	});
  };

  ConditionalAttribute.prototype = {
  	bubble: function () {
  		if (this.node) {
  			this.update();
  		}

  		this.element.bubble();
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		this.fragment.rebind(oldKeypath, newKeypath);
  	},

  	render: function (node) {
  		this.node = node;
  		this.isSvg = node.namespaceURI === namespaces.svg;

  		this.update();
  	},

  	unbind: function () {
  		this.fragment.unbind();
  	},

  	update: function () {
  		var _this = this;

  		var str, attrs;

  		str = this.fragment.toString();
  		attrs = parseAttributes(str, this.isSvg);

  		// any attributes that previously existed but no longer do
  		// must be removed
  		this.attributes.filter(function (a) {
  			return notIn(attrs, a);
  		}).forEach(function (a) {
  			_this.node.removeAttribute(a.name);
  		});

  		attrs.forEach(function (a) {
  			_this.node.setAttribute(a.name, a.value);
  		});

  		this.attributes = attrs;
  	},

  	toString: function () {
  		return this.fragment.toString();
  	}
  };

  var _ConditionalAttribute = ConditionalAttribute;

  function parseAttributes(str, isSvg) {
  	var tag = isSvg ? "svg" : "div";
  	_ConditionalAttribute__div.innerHTML = "<" + tag + " " + str + "></" + tag + ">";

  	return toArray(_ConditionalAttribute__div.childNodes[0].attributes);
  }

  function notIn(haystack, needle) {
  	var i = haystack.length;

  	while (i--) {
  		if (haystack[i].name === needle.name) {
  			return false;
  		}
  	}

  	return true;
  }

  var createConditionalAttributes = function (element, attributes) {
  	if (!attributes) {
  		return [];
  	}

  	return attributes.map(function (a) {
  		return new _ConditionalAttribute(element, a);
  	});
  };

  var Binding = function (element) {
  	var interpolator, keypath, value, parentForm;

  	this.element = element;
  	this.root = element.root;
  	this.attribute = element.attributes[this.name || "value"];

  	interpolator = this.attribute.interpolator;
  	interpolator.twowayBinding = this;

  	if (keypath = interpolator.keypath) {
  		if (keypath.str.slice(-1) === "}") {
  			warnOnceIfDebug("Two-way binding does not work with expressions (`%s` on <%s>)", interpolator.resolver.uniqueString, element.name, { ractive: this.root });
  			return false;
  		}

  		if (keypath.isSpecial) {
  			warnOnceIfDebug("Two-way binding does not work with %s", interpolator.resolver.ref, { ractive: this.root });
  			return false;
  		}
  	} else {
  		// A mustache may be *ambiguous*. Let's say we were given
  		// `value="{{bar}}"`. If the context was `foo`, and `foo.bar`
  		// *wasn't* `undefined`, the keypath would be `foo.bar`.
  		// Then, any user input would result in `foo.bar` being updated.
  		//
  		// If, however, `foo.bar` *was* undefined, and so was `bar`, we would be
  		// left with an unresolved partial keypath - so we are forced to make an
  		// assumption. That assumption is that the input in question should
  		// be forced to resolve to `bar`, and any user input would affect `bar`
  		// and not `foo.bar`.
  		//
  		// Did that make any sense? No? Oh. Sorry. Well the moral of the story is
  		// be explicit when using two-way data-binding about what keypath you're
  		// updating. Using it in lists is probably a recipe for confusion...
  		var ref = interpolator.template.r ? "'" + interpolator.template.r + "' reference" : "expression";
  		warnIfDebug("The %s being used for two-way binding is ambiguous, and may cause unexpected results. Consider initialising your data to eliminate the ambiguity", ref, { ractive: this.root });
  		interpolator.resolver.forceResolution();
  		keypath = interpolator.keypath;
  	}

  	this.attribute.isTwoway = true;
  	this.keypath = keypath;

  	// initialise value, if it's undefined
  	value = this.root.viewmodel.get(keypath);

  	if (value === undefined && this.getInitialValue) {
  		value = this.getInitialValue();

  		if (value !== undefined) {
  			this.root.viewmodel.set(keypath, value);
  		}
  	}

  	if (parentForm = findParentForm(element)) {
  		this.resetValue = value;
  		parentForm.formBindings.push(this);
  	}
  };

  Binding.prototype = {
  	handleChange: function () {
  		var _this = this;

  		global_runloop.start(this.root);
  		this.attribute.locked = true;
  		this.root.viewmodel.set(this.keypath, this.getValue());
  		global_runloop.scheduleTask(function () {
  			return _this.attribute.locked = false;
  		});
  		global_runloop.end();
  	},

  	rebound: function () {
  		var bindings, oldKeypath, newKeypath;

  		oldKeypath = this.keypath;
  		newKeypath = this.attribute.interpolator.keypath;

  		// The attribute this binding is linked to has already done the work
  		if (oldKeypath === newKeypath) {
  			return;
  		}

  		removeFromArray(this.root._twowayBindings[oldKeypath.str], this);

  		this.keypath = newKeypath;

  		bindings = this.root._twowayBindings[newKeypath.str] || (this.root._twowayBindings[newKeypath.str] = []);
  		bindings.push(this);
  	},

  	unbind: function () {}
  };

  Binding.extend = function (properties) {
  	var Parent = this,
  	    SpecialisedBinding;

  	SpecialisedBinding = function (element) {
  		Binding.call(this, element);

  		if (this.init) {
  			this.init();
  		}
  	};

  	SpecialisedBinding.prototype = create(Parent.prototype);
  	utils_object__extend(SpecialisedBinding.prototype, properties);

  	SpecialisedBinding.extend = Binding.extend;

  	return SpecialisedBinding;
  };

  var Binding_Binding = Binding;

  function findParentForm(element) {
  	while (element = element.parent) {
  		if (element.name === "form") {
  			return element;
  		}
  	}
  }

  // this is called when the element is unbound.
  // Specialised bindings can override it

  // This is the handler for DOM events that would lead to a change in the model
  // (i.e. change, sometimes, input, and occasionally click and keyup)
  var handleDomEvent = handleChange;

  function handleChange() {
  	this._ractive.binding.handleChange();
  }

  var GenericBinding;

  GenericBinding = Binding_Binding.extend({
  	getInitialValue: function () {
  		return "";
  	},

  	getValue: function () {
  		return this.element.node.value;
  	},

  	render: function () {
  		var node = this.element.node,
  		    lazy,
  		    timeout = false;
  		this.rendered = true;

  		// any lazy setting for this element overrides the root
  		// if the value is a number, it's a timeout
  		lazy = this.root.lazy;
  		if (this.element.lazy === true) {
  			lazy = true;
  		} else if (this.element.lazy === false) {
  			lazy = false;
  		} else if (is__isNumeric(this.element.lazy)) {
  			lazy = false;
  			timeout = +this.element.lazy;
  		} else if (is__isNumeric(lazy || "")) {
  			timeout = +lazy;
  			lazy = false;

  			// make sure the timeout is available to the handler
  			this.element.lazy = timeout;
  		}

  		this.handler = timeout ? handleDelay : handleDomEvent;

  		node.addEventListener("change", handleDomEvent, false);

  		if (!lazy) {
  			node.addEventListener("input", this.handler, false);

  			if (node.attachEvent) {
  				node.addEventListener("keyup", this.handler, false);
  			}
  		}

  		node.addEventListener("blur", handleBlur, false);
  	},

  	unrender: function () {
  		var node = this.element.node;
  		this.rendered = false;

  		node.removeEventListener("change", handleDomEvent, false);
  		node.removeEventListener("input", this.handler, false);
  		node.removeEventListener("keyup", this.handler, false);
  		node.removeEventListener("blur", handleBlur, false);
  	}
  });

  var Binding_GenericBinding = GenericBinding;

  function handleBlur() {
  	var value;

  	handleDomEvent.call(this);

  	value = this._ractive.root.viewmodel.get(this._ractive.binding.keypath);
  	this.value = value == undefined ? "" : value;
  }

  function handleDelay() {
  	var binding = this._ractive.binding,
  	    el = this;

  	if (!!binding._timeout) clearTimeout(binding._timeout);

  	binding._timeout = setTimeout(function () {
  		if (binding.rendered) handleDomEvent.call(el);
  		binding._timeout = undefined;
  	}, binding.element.lazy);
  }

  var ContentEditableBinding = Binding_GenericBinding.extend({
  	getInitialValue: function () {
  		return this.element.fragment ? this.element.fragment.toString() : "";
  	},

  	getValue: function () {
  		return this.element.node.innerHTML;
  	}
  });

  var Binding_ContentEditableBinding = ContentEditableBinding;

  var shared_getSiblings = getSiblings;
  var sets = {};
  function getSiblings(id, group, keypath) {
  	var hash = id + group + keypath;
  	return sets[hash] || (sets[hash] = []);
  }

  var RadioBinding = Binding_Binding.extend({
  	name: "checked",

  	init: function () {
  		this.siblings = shared_getSiblings(this.root._guid, "radio", this.element.getAttribute("name"));
  		this.siblings.push(this);
  	},

  	render: function () {
  		var node = this.element.node;

  		node.addEventListener("change", handleDomEvent, false);

  		if (node.attachEvent) {
  			node.addEventListener("click", handleDomEvent, false);
  		}
  	},

  	unrender: function () {
  		var node = this.element.node;

  		node.removeEventListener("change", handleDomEvent, false);
  		node.removeEventListener("click", handleDomEvent, false);
  	},

  	handleChange: function () {
  		global_runloop.start(this.root);

  		this.siblings.forEach(function (binding) {
  			binding.root.viewmodel.set(binding.keypath, binding.getValue());
  		});

  		global_runloop.end();
  	},

  	getValue: function () {
  		return this.element.node.checked;
  	},

  	unbind: function () {
  		removeFromArray(this.siblings, this);
  	}
  });

  var Binding_RadioBinding = RadioBinding;

  var RadioNameBinding = Binding_Binding.extend({
  	name: "name",

  	init: function () {
  		this.siblings = shared_getSiblings(this.root._guid, "radioname", this.keypath.str);
  		this.siblings.push(this);

  		this.radioName = true; // so that ractive.updateModel() knows what to do with this
  	},

  	getInitialValue: function () {
  		if (this.element.getAttribute("checked")) {
  			return this.element.getAttribute("value");
  		}
  	},

  	render: function () {
  		var node = this.element.node;

  		node.name = "{{" + this.keypath.str + "}}";
  		node.checked = this.root.viewmodel.get(this.keypath) == this.element.getAttribute("value");

  		node.addEventListener("change", handleDomEvent, false);

  		if (node.attachEvent) {
  			node.addEventListener("click", handleDomEvent, false);
  		}
  	},

  	unrender: function () {
  		var node = this.element.node;

  		node.removeEventListener("change", handleDomEvent, false);
  		node.removeEventListener("click", handleDomEvent, false);
  	},

  	getValue: function () {
  		var node = this.element.node;
  		return node._ractive ? node._ractive.value : node.value;
  	},

  	handleChange: function () {
  		// If this <input> is the one that's checked, then the value of its
  		// `name` keypath gets set to its value
  		if (this.element.node.checked) {
  			Binding_Binding.prototype.handleChange.call(this);
  		}
  	},

  	rebound: function (oldKeypath, newKeypath) {
  		var node;

  		Binding_Binding.prototype.rebound.call(this, oldKeypath, newKeypath);

  		if (node = this.element.node) {
  			node.name = "{{" + this.keypath.str + "}}";
  		}
  	},

  	unbind: function () {
  		removeFromArray(this.siblings, this);
  	}
  });

  var Binding_RadioNameBinding = RadioNameBinding;

  var CheckboxNameBinding = Binding_Binding.extend({
  	name: "name",

  	getInitialValue: function () {
  		// This only gets called once per group (of inputs that
  		// share a name), because it only gets called if there
  		// isn't an initial value. By the same token, we can make
  		// a note of that fact that there was no initial value,
  		// and populate it using any `checked` attributes that
  		// exist (which users should avoid, but which we should
  		// support anyway to avoid breaking expectations)
  		this.noInitialValue = true;
  		return [];
  	},

  	init: function () {
  		var existingValue, bindingValue;

  		this.checkboxName = true; // so that ractive.updateModel() knows what to do with this

  		// Each input has a reference to an array containing it and its
  		// siblings, as two-way binding depends on being able to ascertain
  		// the status of all inputs within the group
  		this.siblings = shared_getSiblings(this.root._guid, "checkboxes", this.keypath.str);
  		this.siblings.push(this);

  		if (this.noInitialValue) {
  			this.siblings.noInitialValue = true;
  		}

  		// If no initial value was set, and this input is checked, we
  		// update the model
  		if (this.siblings.noInitialValue && this.element.getAttribute("checked")) {
  			existingValue = this.root.viewmodel.get(this.keypath);
  			bindingValue = this.element.getAttribute("value");

  			existingValue.push(bindingValue);
  		}
  	},

  	unbind: function () {
  		removeFromArray(this.siblings, this);
  	},

  	render: function () {
  		var node = this.element.node,
  		    existingValue,
  		    bindingValue;

  		existingValue = this.root.viewmodel.get(this.keypath);
  		bindingValue = this.element.getAttribute("value");

  		if (isArray(existingValue)) {
  			this.isChecked = arrayContains(existingValue, bindingValue);
  		} else {
  			this.isChecked = existingValue == bindingValue;
  		}

  		node.name = "{{" + this.keypath.str + "}}";
  		node.checked = this.isChecked;

  		node.addEventListener("change", handleDomEvent, false);

  		// in case of IE emergency, bind to click event as well
  		if (node.attachEvent) {
  			node.addEventListener("click", handleDomEvent, false);
  		}
  	},

  	unrender: function () {
  		var node = this.element.node;

  		node.removeEventListener("change", handleDomEvent, false);
  		node.removeEventListener("click", handleDomEvent, false);
  	},

  	changed: function () {
  		var wasChecked = !!this.isChecked;
  		this.isChecked = this.element.node.checked;
  		return this.isChecked === wasChecked;
  	},

  	handleChange: function () {
  		this.isChecked = this.element.node.checked;
  		Binding_Binding.prototype.handleChange.call(this);
  	},

  	getValue: function () {
  		return this.siblings.filter(isChecked).map(Binding_CheckboxNameBinding__getValue);
  	}
  });

  function isChecked(binding) {
  	return binding.isChecked;
  }

  function Binding_CheckboxNameBinding__getValue(binding) {
  	return binding.element.getAttribute("value");
  }

  var Binding_CheckboxNameBinding = CheckboxNameBinding;

  var CheckboxBinding = Binding_Binding.extend({
  	name: "checked",

  	render: function () {
  		var node = this.element.node;

  		node.addEventListener("change", handleDomEvent, false);

  		if (node.attachEvent) {
  			node.addEventListener("click", handleDomEvent, false);
  		}
  	},

  	unrender: function () {
  		var node = this.element.node;

  		node.removeEventListener("change", handleDomEvent, false);
  		node.removeEventListener("click", handleDomEvent, false);
  	},

  	getValue: function () {
  		return this.element.node.checked;
  	}
  });

  var Binding_CheckboxBinding = CheckboxBinding;

  var SelectBinding = Binding_Binding.extend({
  	getInitialValue: function () {
  		var options = this.element.options,
  		    len,
  		    i,
  		    value,
  		    optionWasSelected;

  		if (this.element.getAttribute("value") !== undefined) {
  			return;
  		}

  		i = len = options.length;

  		if (!len) {
  			return;
  		}

  		// take the final selected option...
  		while (i--) {
  			if (options[i].getAttribute("selected")) {
  				value = options[i].getAttribute("value");
  				optionWasSelected = true;
  				break;
  			}
  		}

  		// or the first non-disabled option, if none are selected
  		if (!optionWasSelected) {
  			while (++i < len) {
  				if (!options[i].getAttribute("disabled")) {
  					value = options[i].getAttribute("value");
  					break;
  				}
  			}
  		}

  		// This is an optimisation (aka hack) that allows us to forgo some
  		// other more expensive work
  		if (value !== undefined) {
  			this.element.attributes.value.value = value;
  		}

  		return value;
  	},

  	render: function () {
  		this.element.node.addEventListener("change", handleDomEvent, false);
  	},

  	unrender: function () {
  		this.element.node.removeEventListener("change", handleDomEvent, false);
  	},

  	// TODO this method is an anomaly... is it necessary?
  	setValue: function (value) {
  		this.root.viewmodel.set(this.keypath, value);
  	},

  	getValue: function () {
  		var options, i, len, option, optionValue;

  		options = this.element.node.options;
  		len = options.length;

  		for (i = 0; i < len; i += 1) {
  			option = options[i];

  			if (options[i].selected) {
  				optionValue = option._ractive ? option._ractive.value : option.value;
  				return optionValue;
  			}
  		}
  	},

  	forceUpdate: function () {
  		var _this = this;

  		var value = this.getValue();

  		if (value !== undefined) {
  			this.attribute.locked = true;
  			global_runloop.scheduleTask(function () {
  				return _this.attribute.locked = false;
  			});
  			this.root.viewmodel.set(this.keypath, value);
  		}
  	}
  });

  var Binding_SelectBinding = SelectBinding;

  var MultipleSelectBinding = Binding_SelectBinding.extend({
  	getInitialValue: function () {
  		return this.element.options.filter(function (option) {
  			return option.getAttribute("selected");
  		}).map(function (option) {
  			return option.getAttribute("value");
  		});
  	},

  	render: function () {
  		var valueFromModel;

  		this.element.node.addEventListener("change", handleDomEvent, false);

  		valueFromModel = this.root.viewmodel.get(this.keypath);

  		if (valueFromModel === undefined) {
  			// get value from DOM, if possible
  			this.handleChange();
  		}
  	},

  	unrender: function () {
  		this.element.node.removeEventListener("change", handleDomEvent, false);
  	},

  	setValue: function () {
  		throw new Error("TODO not implemented yet");
  	},

  	getValue: function () {
  		var selectedValues, options, i, len, option, optionValue;

  		selectedValues = [];
  		options = this.element.node.options;
  		len = options.length;

  		for (i = 0; i < len; i += 1) {
  			option = options[i];

  			if (option.selected) {
  				optionValue = option._ractive ? option._ractive.value : option.value;
  				selectedValues.push(optionValue);
  			}
  		}

  		return selectedValues;
  	},

  	handleChange: function () {
  		var attribute, previousValue, value;

  		attribute = this.attribute;
  		previousValue = attribute.value;

  		value = this.getValue();

  		if (previousValue === undefined || !arrayContentsMatch(value, previousValue)) {
  			Binding_SelectBinding.prototype.handleChange.call(this);
  		}

  		return this;
  	},

  	forceUpdate: function () {
  		var _this = this;

  		var value = this.getValue();

  		if (value !== undefined) {
  			this.attribute.locked = true;
  			global_runloop.scheduleTask(function () {
  				return _this.attribute.locked = false;
  			});
  			this.root.viewmodel.set(this.keypath, value);
  		}
  	},

  	updateModel: function () {
  		if (this.attribute.value === undefined || !this.attribute.value.length) {
  			this.root.viewmodel.set(this.keypath, this.initialValue);
  		}
  	}
  });

  var Binding_MultipleSelectBinding = MultipleSelectBinding;

  var FileListBinding = Binding_Binding.extend({
  	render: function () {
  		this.element.node.addEventListener("change", handleDomEvent, false);
  	},

  	unrender: function () {
  		this.element.node.removeEventListener("change", handleDomEvent, false);
  	},

  	getValue: function () {
  		return this.element.node.files;
  	}
  });

  var Binding_FileListBinding = FileListBinding;

  var NumericBinding = Binding_GenericBinding.extend({
  	getInitialValue: function () {
  		return undefined;
  	},

  	getValue: function () {
  		var value = parseFloat(this.element.node.value);
  		return isNaN(value) ? undefined : value;
  	}
  });

  var init_createTwowayBinding = createTwowayBinding;

  function createTwowayBinding(element) {
  	var attributes = element.attributes,
  	    type,
  	    Binding,
  	    bindName,
  	    bindChecked,
  	    binding;

  	// if this is a late binding, and there's already one, it
  	// needs to be torn down
  	if (element.binding) {
  		element.binding.teardown();
  		element.binding = null;
  	}

  	// contenteditable
  	if (
  	// if the contenteditable attribute is true or is bindable and may thus become true
  	(element.getAttribute("contenteditable") || !!attributes.contenteditable && isBindable(attributes.contenteditable)) && isBindable(attributes.value)) {
  		Binding = Binding_ContentEditableBinding;
  	}

  	// <input>
  	else if (element.name === "input") {
  		type = element.getAttribute("type");

  		if (type === "radio" || type === "checkbox") {
  			bindName = isBindable(attributes.name);
  			bindChecked = isBindable(attributes.checked);

  			// we can either bind the name attribute, or the checked attribute - not both
  			if (bindName && bindChecked) {
  				warnIfDebug("A radio input can have two-way binding on its name attribute, or its checked attribute - not both", { ractive: element.root });
  			}

  			if (bindName) {
  				Binding = type === "radio" ? Binding_RadioNameBinding : Binding_CheckboxNameBinding;
  			} else if (bindChecked) {
  				Binding = type === "radio" ? Binding_RadioBinding : Binding_CheckboxBinding;
  			}
  		} else if (type === "file" && isBindable(attributes.value)) {
  			Binding = Binding_FileListBinding;
  		} else if (isBindable(attributes.value)) {
  			Binding = type === "number" || type === "range" ? NumericBinding : Binding_GenericBinding;
  		}
  	}

  	// <select>
  	else if (element.name === "select" && isBindable(attributes.value)) {
  		Binding = element.getAttribute("multiple") ? Binding_MultipleSelectBinding : Binding_SelectBinding;
  	}

  	// <textarea>
  	else if (element.name === "textarea" && isBindable(attributes.value)) {
  		Binding = Binding_GenericBinding;
  	}

  	if (Binding && (binding = new Binding(element)) && binding.keypath) {
  		return binding;
  	}
  }

  function isBindable(attribute) {
  	return attribute && attribute.isBindable;
  }

  // and this element also has a value attribute to bind

  var EventHandler_prototype_bubble = EventHandler$bubble;

  function EventHandler$bubble() {
  	var hasAction = this.getAction();

  	if (hasAction && !this.hasListener) {
  		this.listen();
  	} else if (!hasAction && this.hasListener) {
  		this.unrender();
  	}
  }

  // This function may be overwritten, if the event directive
  // includes parameters
  var EventHandler_prototype_fire = EventHandler$fire;
  function EventHandler$fire(event) {
  	shared_fireEvent(this.root, this.getAction(), { event: event });
  }

  var getAction = EventHandler$getAction;

  function EventHandler$getAction() {
  	return this.action.toString().trim();
  }

  var EventHandler_prototype_init = EventHandler$init;

  var eventPattern = /^event(?:\.(.+))?/;
  function EventHandler$init(element, name, template) {
  	var _this = this;

  	var action, refs, ractive;

  	this.element = element;
  	this.root = element.root;
  	this.parentFragment = element.parentFragment;
  	this.name = name;

  	if (name.indexOf("*") !== -1) {
  		fatal("Only component proxy-events may contain \"*\" wildcards, <%s on-%s=\"...\"/> is not valid", element.name, name);
  		this.invalid = true;
  	}

  	if (template.m) {
  		refs = template.a.r;

  		// This is a method call
  		this.method = template.m;
  		this.keypaths = [];
  		this.fn = shared_getFunctionFromString(template.a.s, refs.length);

  		this.parentFragment = element.parentFragment;
  		ractive = this.root;

  		// Create resolvers for each reference
  		this.refResolvers = [];
  		refs.forEach(function (ref, i) {
  			var match = undefined;

  			// special case - the `event` object
  			if (match = eventPattern.exec(ref)) {
  				_this.keypaths[i] = {
  					eventObject: true,
  					refinements: match[1] ? match[1].split(".") : []
  				};
  			} else {
  				_this.refResolvers.push(Resolvers_createReferenceResolver(_this, ref, function (keypath) {
  					return _this.resolve(i, keypath);
  				}));
  			}
  		});

  		this.fire = fireMethodCall;
  	} else {
  		// Get action ('foo' in 'on-click='foo')
  		action = template.n || template;
  		if (typeof action !== "string") {
  			action = new virtualdom_Fragment({
  				template: action,
  				root: this.root,
  				owner: this
  			});
  		}

  		this.action = action;

  		// Get parameters
  		if (template.d) {
  			this.dynamicParams = new virtualdom_Fragment({
  				template: template.d,
  				root: this.root,
  				owner: this.element
  			});

  			this.fire = fireEventWithDynamicParams;
  		} else if (template.a) {
  			this.params = template.a;
  			this.fire = fireEventWithParams;
  		}
  	}
  }

  function fireMethodCall(event) {
  	var ractive, values, args;

  	ractive = this.root;

  	if (typeof ractive[this.method] !== "function") {
  		throw new Error("Attempted to call a non-existent method (\"" + this.method + "\")");
  	}

  	values = this.keypaths.map(function (keypath) {
  		var value, len, i;

  		if (keypath === undefined) {
  			// not yet resolved
  			return undefined;
  		}

  		// TODO the refinements stuff would be better handled at parse time
  		if (keypath.eventObject) {
  			value = event;

  			if (len = keypath.refinements.length) {
  				for (i = 0; i < len; i += 1) {
  					value = value[keypath.refinements[i]];
  				}
  			}
  		} else {
  			value = ractive.viewmodel.get(keypath);
  		}

  		return value;
  	});

  	shared_eventStack.enqueue(ractive, event);

  	args = this.fn.apply(null, values);
  	ractive[this.method].apply(ractive, args);

  	shared_eventStack.dequeue(ractive);
  }

  function fireEventWithParams(event) {
  	shared_fireEvent(this.root, this.getAction(), { event: event, args: this.params });
  }

  function fireEventWithDynamicParams(event) {
  	var args = this.dynamicParams.getArgsList();

  	// need to strip [] from ends if a string!
  	if (typeof args === "string") {
  		args = args.substr(1, args.length - 2);
  	}

  	shared_fireEvent(this.root, this.getAction(), { event: event, args: args });
  }

  var shared_genericHandler = genericHandler;
  function genericHandler(event) {
  	var storage,
  	    handler,
  	    indices,
  	    index = {};

  	storage = this._ractive;
  	handler = storage.events[event.type];

  	if (indices = Resolvers_findIndexRefs(handler.element.parentFragment)) {
  		index = Resolvers_findIndexRefs.resolve(indices);
  	}

  	handler.fire({
  		node: this,
  		original: event,
  		index: index,
  		keypath: storage.keypath.str,
  		context: storage.root.viewmodel.get(storage.keypath)
  	});
  }

  var listen = EventHandler$listen;

  var customHandlers = {},
      touchEvents = {
  	touchstart: true,
  	touchmove: true,
  	touchend: true,
  	touchcancel: true,
  	//not w3c, but supported in some browsers
  	touchleave: true
  };
  function EventHandler$listen() {
  	var definition,
  	    name = this.name;

  	if (this.invalid) {
  		return;
  	}

  	if (definition = findInViewHierarchy("events", this.root, name)) {
  		this.custom = definition(this.node, getCustomHandler(name));
  	} else {
  		// Looks like we're dealing with a standard DOM event... but let's check
  		if (!("on" + name in this.node) && !(window && "on" + name in window) && !isJsdom) {

  			// okay to use touch events if this browser doesn't support them
  			if (!touchEvents[name]) {
  				warnOnceIfDebug(missingPlugin(name, "event"), { node: this.node });
  			}

  			return;
  		}

  		this.node.addEventListener(name, shared_genericHandler, false);
  	}

  	this.hasListener = true;
  }

  function getCustomHandler(name) {
  	if (!customHandlers[name]) {
  		customHandlers[name] = function (event) {
  			var storage = event.node._ractive;

  			event.index = storage.index;
  			event.keypath = storage.keypath.str;
  			event.context = storage.root.viewmodel.get(storage.keypath);

  			storage.events[name].fire(event);
  		};
  	}

  	return customHandlers[name];
  }

  var EventHandler_prototype_rebind = EventHandler$rebind;

  function EventHandler$rebind(oldKeypath, newKeypath) {
  	var fragment;
  	if (this.method) {
  		fragment = this.element.parentFragment;
  		this.refResolvers.forEach(rebind);

  		return;
  	}

  	if (typeof this.action !== "string") {
  		rebind(this.action);
  	}

  	if (this.dynamicParams) {
  		rebind(this.dynamicParams);
  	}

  	function rebind(thing) {
  		thing && thing.rebind(oldKeypath, newKeypath);
  	}
  }

  var EventHandler_prototype_render = EventHandler$render;

  function EventHandler$render() {
  	this.node = this.element.node;
  	// store this on the node itself, so it can be retrieved by a
  	// universal handler
  	this.node._ractive.events[this.name] = this;

  	if (this.method || this.getAction()) {
  		this.listen();
  	}
  }

  var prototype_resolve = EventHandler$resolve;

  function EventHandler$resolve(index, keypath) {
  	this.keypaths[index] = keypath;
  }

  var EventHandler_prototype_unbind = EventHandler$unbind;
  function EventHandler$unbind() {
  	if (this.method) {
  		this.refResolvers.forEach(methodCallers__unbind);
  		return;
  	}

  	// Tear down dynamic name
  	if (typeof this.action !== "string") {
  		this.action.unbind();
  	}

  	// Tear down dynamic parameters
  	if (this.dynamicParams) {
  		this.dynamicParams.unbind();
  	}
  }

  var EventHandler_prototype_unrender = EventHandler$unrender;
  function EventHandler$unrender() {

  	if (this.custom) {
  		this.custom.teardown();
  	} else {
  		this.node.removeEventListener(this.name, shared_genericHandler, false);
  	}

  	this.hasListener = false;
  }

  var EventHandler = function (element, name, template) {
  	this.init(element, name, template);
  };

  EventHandler.prototype = {
  	bubble: EventHandler_prototype_bubble,
  	fire: EventHandler_prototype_fire,
  	getAction: getAction,
  	init: EventHandler_prototype_init,
  	listen: listen,
  	rebind: EventHandler_prototype_rebind,
  	render: EventHandler_prototype_render,
  	resolve: prototype_resolve,
  	unbind: EventHandler_prototype_unbind,
  	unrender: EventHandler_prototype_unrender
  };

  var _EventHandler = EventHandler;

  var createEventHandlers = function (element, template) {
  	var i,
  	    name,
  	    names,
  	    handler,
  	    result = [];

  	for (name in template) {
  		if (template.hasOwnProperty(name)) {
  			names = name.split("-");
  			i = names.length;

  			while (i--) {
  				handler = new _EventHandler(element, names[i], template[name]);
  				result.push(handler);
  			}
  		}
  	}

  	return result;
  };

  var Decorator = function (element, template) {
  	var self = this,
  	    ractive,
  	    name,
  	    fragment;

  	this.element = element;
  	this.root = ractive = element.root;

  	name = template.n || template;

  	if (typeof name !== "string") {
  		fragment = new virtualdom_Fragment({
  			template: name,
  			root: ractive,
  			owner: element
  		});

  		name = fragment.toString();
  		fragment.unbind();

  		if (name === "") {
  			// empty string okay, just no decorator
  			return;
  		}
  	}

  	if (template.a) {
  		this.params = template.a;
  	} else if (template.d) {
  		this.fragment = new virtualdom_Fragment({
  			template: template.d,
  			root: ractive,
  			owner: element
  		});

  		this.params = this.fragment.getArgsList();

  		this.fragment.bubble = function () {
  			this.dirtyArgs = this.dirtyValue = true;
  			self.params = this.getArgsList();

  			if (self.ready) {
  				self.update();
  			}
  		};
  	}

  	this.fn = findInViewHierarchy("decorators", ractive, name);

  	if (!this.fn) {
  		fatal(missingPlugin(name, "decorator"));
  	}
  };

  Decorator.prototype = {
  	init: function () {
  		var node, result, args;

  		node = this.element.node;

  		if (this.params) {
  			args = [node].concat(this.params);
  			result = this.fn.apply(this.root, args);
  		} else {
  			result = this.fn.call(this.root, node);
  		}

  		if (!result || !result.teardown) {
  			throw new Error("Decorator definition must return an object with a teardown method");
  		}

  		// TODO does this make sense?
  		this.actual = result;
  		this.ready = true;
  	},

  	update: function () {
  		if (this.actual.update) {
  			this.actual.update.apply(this.root, this.params);
  		} else {
  			this.actual.teardown(true);
  			this.init();
  		}
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		if (this.fragment) {
  			this.fragment.rebind(oldKeypath, newKeypath);
  		}
  	},

  	teardown: function (updating) {
  		this.torndown = true;
  		if (this.ready) {
  			this.actual.teardown();
  		}

  		if (!updating && this.fragment) {
  			this.fragment.unbind();
  		}
  	}
  };

  var _Decorator = Decorator;

  function select__bubble() {
  	var _this = this;

  	if (!this.dirty) {
  		this.dirty = true;

  		global_runloop.scheduleTask(function () {
  			sync(_this);
  			_this.dirty = false;
  		});
  	}

  	this.parentFragment.bubble(); // default behaviour
  }

  function sync(selectElement) {
  	var selectNode, selectValue, isMultiple, options, optionWasSelected;

  	selectNode = selectElement.node;

  	if (!selectNode) {
  		return;
  	}

  	options = toArray(selectNode.options);

  	selectValue = selectElement.getAttribute("value");
  	isMultiple = selectElement.getAttribute("multiple");

  	// If the <select> has a specified value, that should override
  	// these options
  	if (selectValue !== undefined) {
  		options.forEach(function (o) {
  			var optionValue, shouldSelect;

  			optionValue = o._ractive ? o._ractive.value : o.value;
  			shouldSelect = isMultiple ? valueContains(selectValue, optionValue) : selectValue == optionValue;

  			if (shouldSelect) {
  				optionWasSelected = true;
  			}

  			o.selected = shouldSelect;
  		});

  		if (!optionWasSelected) {
  			if (options[0]) {
  				options[0].selected = true;
  			}

  			if (selectElement.binding) {
  				selectElement.binding.forceUpdate();
  			}
  		}
  	}

  	// Otherwise the value should be initialised according to which
  	// <option> element is selected, if twoway binding is in effect
  	else if (selectElement.binding) {
  		selectElement.binding.forceUpdate();
  	}
  }

  function valueContains(selectValue, optionValue) {
  	var i = selectValue.length;
  	while (i--) {
  		if (selectValue[i] == optionValue) {
  			return true;
  		}
  	}
  }

  function special_option__init(option, template) {
  	option.select = findParentSelect(option.parent);

  	// we might be inside a <datalist> element
  	if (!option.select) {
  		return;
  	}

  	option.select.options.push(option);

  	// If the value attribute is missing, use the element's content
  	if (!template.a) {
  		template.a = {};
  	}

  	// ...as long as it isn't disabled
  	if (template.a.value === undefined && !template.a.hasOwnProperty("disabled")) {
  		template.a.value = template.f;
  	}

  	// If there is a `selected` attribute, but the <select>
  	// already has a value, delete it
  	if ("selected" in template.a && option.select.getAttribute("value") !== undefined) {
  		delete template.a.selected;
  	}
  }

  function special_option__unbind(option) {
  	if (option.select) {
  		removeFromArray(option.select.options, option);
  	}
  }

  function findParentSelect(element) {
  	if (!element) {
  		return;
  	}

  	do {
  		if (element.name === "select") {
  			return element;
  		}
  	} while (element = element.parent);
  }

  var Element_prototype_init = Element$init;
  function Element$init(options) {
  	var parentFragment, template, ractive, binding, bindings, twoway, bindingAttrs;

  	this.type = ELEMENT;

  	// stuff we'll need later
  	parentFragment = this.parentFragment = options.parentFragment;
  	template = this.template = options.template;

  	this.parent = options.pElement || parentFragment.pElement;

  	this.root = ractive = parentFragment.root;
  	this.index = options.index;
  	this.key = options.key;

  	this.name = enforceCase(template.e);

  	// Special case - <option> elements
  	if (this.name === "option") {
  		special_option__init(this, template);
  	}

  	// Special case - <select> elements
  	if (this.name === "select") {
  		this.options = [];
  		this.bubble = select__bubble; // TODO this is a kludge
  	}

  	// Special case - <form> elements
  	if (this.name === "form") {
  		this.formBindings = [];
  	}

  	// handle binding attributes first (twoway, lazy)
  	bindingAttrs = processBindingAttributes(this, template);

  	// create attributes
  	this.attributes = createAttributes(this, template.a);
  	this.conditionalAttributes = createConditionalAttributes(this, template.m);

  	// append children, if there are any
  	if (template.f) {
  		this.fragment = new virtualdom_Fragment({
  			template: template.f,
  			root: ractive,
  			owner: this,
  			pElement: this,
  			cssIds: null
  		});
  	}

  	// the element setting should override the ractive setting
  	twoway = ractive.twoway;
  	if (bindingAttrs.twoway === false) twoway = false;else if (bindingAttrs.twoway === true) twoway = true;

  	this.twoway = twoway;
  	this.lazy = bindingAttrs.lazy;

  	// create twoway binding
  	if (twoway && (binding = init_createTwowayBinding(this, template.a))) {
  		this.binding = binding;

  		// register this with the root, so that we can do ractive.updateModel()
  		bindings = this.root._twowayBindings[binding.keypath.str] || (this.root._twowayBindings[binding.keypath.str] = []);
  		bindings.push(binding);
  	}

  	// create event proxies
  	if (template.v) {
  		this.eventHandlers = createEventHandlers(this, template.v);
  	}

  	// create decorator
  	if (template.o) {
  		this.decorator = new _Decorator(this, template.o);
  	}

  	// create transitions
  	this.intro = template.t0 || template.t1;
  	this.outro = template.t0 || template.t2;
  }

  var Element_prototype_rebind = Element$rebind;
  function Element$rebind(oldKeypath, newKeypath) {
  	var i, storage, liveQueries, ractive;

  	if (this.attributes) {
  		this.attributes.forEach(rebind);
  	}

  	if (this.conditionalAttributes) {
  		this.conditionalAttributes.forEach(rebind);
  	}

  	if (this.eventHandlers) {
  		this.eventHandlers.forEach(rebind);
  	}

  	if (this.decorator) {
  		rebind(this.decorator);
  	}

  	// rebind children
  	if (this.fragment) {
  		rebind(this.fragment);
  	}

  	// Update live queries, if necessary
  	if (liveQueries = this.liveQueries) {
  		ractive = this.root;

  		i = liveQueries.length;
  		while (i--) {
  			liveQueries[i]._makeDirty();
  		}
  	}

  	if (this.node && (storage = this.node._ractive)) {

  		// adjust keypath if needed
  		assignNewKeypath(storage, "keypath", oldKeypath, newKeypath);
  	}

  	function rebind(thing) {
  		thing.rebind(oldKeypath, newKeypath);
  	}
  }

  function special_img__render(img) {
  	var loadHandler;

  	// if this is an <img>, and we're in a crap browser, we may need to prevent it
  	// from overriding width and height when it loads the src
  	if (img.attributes.width || img.attributes.height) {
  		img.node.addEventListener("load", loadHandler = function () {
  			var width = img.getAttribute("width"),
  			    height = img.getAttribute("height");

  			if (width !== undefined) {
  				img.node.setAttribute("width", width);
  			}

  			if (height !== undefined) {
  				img.node.setAttribute("height", height);
  			}

  			img.node.removeEventListener("load", loadHandler, false);
  		}, false);
  	}
  }

  function form__render(element) {
  	element.node.addEventListener("reset", handleReset, false);
  }

  function form__unrender(element) {
  	element.node.removeEventListener("reset", handleReset, false);
  }

  function handleReset() {
  	var element = this._ractive.proxy;

  	global_runloop.start();
  	element.formBindings.forEach(updateModel);
  	global_runloop.end();
  }

  function updateModel(binding) {
  	binding.root.viewmodel.set(binding.keypath, binding.resetValue);
  }

  var Transition_prototype_init = Transition$init;
  function Transition$init(element, template, isIntro) {
  	var ractive, name, fragment;

  	this.element = element;
  	this.root = ractive = element.root;
  	this.isIntro = isIntro;

  	name = template.n || template;

  	if (typeof name !== "string") {
  		fragment = new virtualdom_Fragment({
  			template: name,
  			root: ractive,
  			owner: element
  		});

  		name = fragment.toString();
  		fragment.unbind();

  		if (name === "") {
  			// empty string okay, just no transition
  			return;
  		}
  	}

  	this.name = name;

  	if (template.a) {
  		this.params = template.a;
  	} else if (template.d) {
  		// TODO is there a way to interpret dynamic arguments without all the
  		// 'dependency thrashing'?
  		fragment = new virtualdom_Fragment({
  			template: template.d,
  			root: ractive,
  			owner: element
  		});

  		this.params = fragment.getArgsList();
  		fragment.unbind();
  	}

  	this._fn = findInViewHierarchy("transitions", ractive, name);

  	if (!this._fn) {
  		warnOnceIfDebug(missingPlugin(name, "transition"), { ractive: this.root });
  	}
  }

  var camelCase = function (hyphenatedStr) {
  	return hyphenatedStr.replace(/-([a-zA-Z])/g, function (match, $1) {
  		return $1.toUpperCase();
  	});
  };

  var helpers_prefix__prefix, prefixCache, helpers_prefix__testStyle;

  if (!isClient) {
  	helpers_prefix__prefix = null;
  } else {
  	prefixCache = {};
  	helpers_prefix__testStyle = createElement("div").style;

  	helpers_prefix__prefix = function (prop) {
  		var i, vendor, capped;

  		prop = camelCase(prop);

  		if (!prefixCache[prop]) {
  			if (helpers_prefix__testStyle[prop] !== undefined) {
  				prefixCache[prop] = prop;
  			} else {
  				// test vendors...
  				capped = prop.charAt(0).toUpperCase() + prop.substring(1);

  				i = vendors.length;
  				while (i--) {
  					vendor = vendors[i];
  					if (helpers_prefix__testStyle[vendor + capped] !== undefined) {
  						prefixCache[prop] = vendor + capped;
  						break;
  					}
  				}
  			}
  		}

  		return prefixCache[prop];
  	};
  }

  var helpers_prefix = helpers_prefix__prefix;

  var getStyle, prototype_getStyle__getComputedStyle;

  if (!isClient) {
  	getStyle = null;
  } else {
  	prototype_getStyle__getComputedStyle = window.getComputedStyle || legacy.getComputedStyle;

  	getStyle = function (props) {
  		var computedStyle, styles, i, prop, value;

  		computedStyle = prototype_getStyle__getComputedStyle(this.node);

  		if (typeof props === "string") {
  			value = computedStyle[helpers_prefix(props)];
  			if (value === "0px") {
  				value = 0;
  			}
  			return value;
  		}

  		if (!isArray(props)) {
  			throw new Error("Transition$getStyle must be passed a string, or an array of strings representing CSS properties");
  		}

  		styles = {};

  		i = props.length;
  		while (i--) {
  			prop = props[i];
  			value = computedStyle[helpers_prefix(prop)];
  			if (value === "0px") {
  				value = 0;
  			}
  			styles[prop] = value;
  		}

  		return styles;
  	};
  }

  var prototype_getStyle = getStyle;

  var setStyle = function (style, value) {
  	var prop;

  	if (typeof style === "string") {
  		this.node.style[helpers_prefix(style)] = value;
  	} else {
  		for (prop in style) {
  			if (style.hasOwnProperty(prop)) {
  				this.node.style[helpers_prefix(prop)] = style[prop];
  			}
  		}
  	}

  	return this;
  };

  var Ticker = function (options) {
  	var easing;

  	this.duration = options.duration;
  	this.step = options.step;
  	this.complete = options.complete;

  	// easing
  	if (typeof options.easing === "string") {
  		easing = options.root.easing[options.easing];

  		if (!easing) {
  			warnOnceIfDebug(missingPlugin(options.easing, "easing"));
  			easing = linear;
  		}
  	} else if (typeof options.easing === "function") {
  		easing = options.easing;
  	} else {
  		easing = linear;
  	}

  	this.easing = easing;

  	this.start = utils_getTime();
  	this.end = this.start + this.duration;

  	this.running = true;
  	shared_animations.add(this);
  };

  Ticker.prototype = {
  	tick: function (now) {
  		var elapsed, eased;

  		if (!this.running) {
  			return false;
  		}

  		if (now > this.end) {
  			if (this.step) {
  				this.step(1);
  			}

  			if (this.complete) {
  				this.complete(1);
  			}

  			return false;
  		}

  		elapsed = now - this.start;
  		eased = this.easing(elapsed / this.duration);

  		if (this.step) {
  			this.step(eased);
  		}

  		return true;
  	},

  	stop: function () {
  		if (this.abort) {
  			this.abort();
  		}

  		this.running = false;
  	}
  };

  var shared_Ticker = Ticker;
  function linear(t) {
  	return t;
  }

  var unprefixPattern = new RegExp("^-(?:" + vendors.join("|") + ")-");

  var unprefix = function (prop) {
  	return prop.replace(unprefixPattern, "");
  };

  var vendorPattern = new RegExp("^(?:" + vendors.join("|") + ")([A-Z])");

  var hyphenate = function (str) {
  	var hyphenated;

  	if (!str) {
  		return ""; // edge case
  	}

  	if (vendorPattern.test(str)) {
  		str = "-" + str;
  	}

  	hyphenated = str.replace(/[A-Z]/g, function (match) {
  		return "-" + match.toLowerCase();
  	});

  	return hyphenated;
  };

  var createTransitions,
      animateStyle_createTransitions__testStyle,
      TRANSITION,
      TRANSITIONEND,
      CSS_TRANSITIONS_ENABLED,
      TRANSITION_DURATION,
      TRANSITION_PROPERTY,
      TRANSITION_TIMING_FUNCTION,
      canUseCssTransitions = {},
      cannotUseCssTransitions = {};

  if (!isClient) {
  	createTransitions = null;
  } else {
  	animateStyle_createTransitions__testStyle = createElement("div").style;

  	// determine some facts about our environment
  	(function () {
  		if (animateStyle_createTransitions__testStyle.transition !== undefined) {
  			TRANSITION = "transition";
  			TRANSITIONEND = "transitionend";
  			CSS_TRANSITIONS_ENABLED = true;
  		} else if (animateStyle_createTransitions__testStyle.webkitTransition !== undefined) {
  			TRANSITION = "webkitTransition";
  			TRANSITIONEND = "webkitTransitionEnd";
  			CSS_TRANSITIONS_ENABLED = true;
  		} else {
  			CSS_TRANSITIONS_ENABLED = false;
  		}
  	})();

  	if (TRANSITION) {
  		TRANSITION_DURATION = TRANSITION + "Duration";
  		TRANSITION_PROPERTY = TRANSITION + "Property";
  		TRANSITION_TIMING_FUNCTION = TRANSITION + "TimingFunction";
  	}

  	createTransitions = function (t, to, options, changedProperties, resolve) {

  		// Wait a beat (otherwise the target styles will be applied immediately)
  		// TODO use a fastdom-style mechanism?
  		setTimeout(function () {

  			var hashPrefix, jsTransitionsComplete, cssTransitionsComplete, checkComplete, transitionEndHandler;

  			checkComplete = function () {
  				if (jsTransitionsComplete && cssTransitionsComplete) {
  					// will changes to events and fire have an unexpected consequence here?
  					t.root.fire(t.name + ":end", t.node, t.isIntro);
  					resolve();
  				}
  			};

  			// this is used to keep track of which elements can use CSS to animate
  			// which properties
  			hashPrefix = (t.node.namespaceURI || "") + t.node.tagName;

  			t.node.style[TRANSITION_PROPERTY] = changedProperties.map(helpers_prefix).map(hyphenate).join(",");
  			t.node.style[TRANSITION_TIMING_FUNCTION] = hyphenate(options.easing || "linear");
  			t.node.style[TRANSITION_DURATION] = options.duration / 1000 + "s";

  			transitionEndHandler = function (event) {
  				var index;

  				index = changedProperties.indexOf(camelCase(unprefix(event.propertyName)));
  				if (index !== -1) {
  					changedProperties.splice(index, 1);
  				}

  				if (changedProperties.length) {
  					// still transitioning...
  					return;
  				}

  				t.node.removeEventListener(TRANSITIONEND, transitionEndHandler, false);

  				cssTransitionsComplete = true;
  				checkComplete();
  			};

  			t.node.addEventListener(TRANSITIONEND, transitionEndHandler, false);

  			setTimeout(function () {
  				var i = changedProperties.length,
  				    hash,
  				    originalValue,
  				    index,
  				    propertiesToTransitionInJs = [],
  				    prop,
  				    suffix;

  				while (i--) {
  					prop = changedProperties[i];
  					hash = hashPrefix + prop;

  					if (CSS_TRANSITIONS_ENABLED && !cannotUseCssTransitions[hash]) {
  						t.node.style[helpers_prefix(prop)] = to[prop];

  						// If we're not sure if CSS transitions are supported for
  						// this tag/property combo, find out now
  						if (!canUseCssTransitions[hash]) {
  							originalValue = t.getStyle(prop);

  							// if this property is transitionable in this browser,
  							// the current style will be different from the target style
  							canUseCssTransitions[hash] = t.getStyle(prop) != to[prop];
  							cannotUseCssTransitions[hash] = !canUseCssTransitions[hash];

  							// Reset, if we're going to use timers after all
  							if (cannotUseCssTransitions[hash]) {
  								t.node.style[helpers_prefix(prop)] = originalValue;
  							}
  						}
  					}

  					if (!CSS_TRANSITIONS_ENABLED || cannotUseCssTransitions[hash]) {
  						// we need to fall back to timer-based stuff
  						if (originalValue === undefined) {
  							originalValue = t.getStyle(prop);
  						}

  						// need to remove this from changedProperties, otherwise transitionEndHandler
  						// will get confused
  						index = changedProperties.indexOf(prop);
  						if (index === -1) {
  							warnIfDebug("Something very strange happened with transitions. Please raise an issue at https://github.com/ractivejs/ractive/issues - thanks!", { node: t.node });
  						} else {
  							changedProperties.splice(index, 1);
  						}

  						// TODO Determine whether this property is animatable at all

  						suffix = /[^\d]*$/.exec(to[prop])[0];

  						// ...then kick off a timer-based transition
  						propertiesToTransitionInJs.push({
  							name: helpers_prefix(prop),
  							interpolator: shared_interpolate(parseFloat(originalValue), parseFloat(to[prop])),
  							suffix: suffix
  						});
  					}
  				}

  				// javascript transitions
  				if (propertiesToTransitionInJs.length) {
  					new shared_Ticker({
  						root: t.root,
  						duration: options.duration,
  						easing: camelCase(options.easing || ""),
  						step: function (pos) {
  							var prop, i;

  							i = propertiesToTransitionInJs.length;
  							while (i--) {
  								prop = propertiesToTransitionInJs[i];
  								t.node.style[prop.name] = prop.interpolator(pos) + prop.suffix;
  							}
  						},
  						complete: function () {
  							jsTransitionsComplete = true;
  							checkComplete();
  						}
  					});
  				} else {
  					jsTransitionsComplete = true;
  				}

  				if (!changedProperties.length) {
  					// We need to cancel the transitionEndHandler, and deal with
  					// the fact that it will never fire
  					t.node.removeEventListener(TRANSITIONEND, transitionEndHandler, false);
  					cssTransitionsComplete = true;
  					checkComplete();
  				}
  			}, 0);
  		}, options.delay || 0);
  	};
  }

  var animateStyle_createTransitions = createTransitions;

  var hidden, vendor, animateStyle_visibility__prefix, animateStyle_visibility__i, visibility;

  if (typeof document !== "undefined") {
  	hidden = "hidden";

  	visibility = {};

  	if (hidden in document) {
  		animateStyle_visibility__prefix = "";
  	} else {
  		animateStyle_visibility__i = vendors.length;
  		while (animateStyle_visibility__i--) {
  			vendor = vendors[animateStyle_visibility__i];
  			hidden = vendor + "Hidden";

  			if (hidden in document) {
  				animateStyle_visibility__prefix = vendor;
  			}
  		}
  	}

  	if (animateStyle_visibility__prefix !== undefined) {
  		document.addEventListener(animateStyle_visibility__prefix + "visibilitychange", onChange);

  		// initialise
  		onChange();
  	} else {
  		// gah, we're in an old browser
  		if ("onfocusout" in document) {
  			document.addEventListener("focusout", onHide);
  			document.addEventListener("focusin", onShow);
  		} else {
  			window.addEventListener("pagehide", onHide);
  			window.addEventListener("blur", onHide);

  			window.addEventListener("pageshow", onShow);
  			window.addEventListener("focus", onShow);
  		}

  		visibility.hidden = false; // until proven otherwise. Not ideal but hey
  	}
  }

  function onChange() {
  	visibility.hidden = document[hidden];
  }

  function onHide() {
  	visibility.hidden = true;
  }

  function onShow() {
  	visibility.hidden = false;
  }

  var animateStyle_visibility = visibility;

  var animateStyle, _animateStyle__getComputedStyle, resolved;

  if (!isClient) {
  	animateStyle = null;
  } else {
  	_animateStyle__getComputedStyle = window.getComputedStyle || legacy.getComputedStyle;

  	animateStyle = function (style, value, options) {
  		var _this = this;

  		var to;

  		if (arguments.length === 4) {
  			throw new Error("t.animateStyle() returns a promise - use .then() instead of passing a callback");
  		}

  		// Special case - page isn't visible. Don't animate anything, because
  		// that way you'll never get CSS transitionend events
  		if (animateStyle_visibility.hidden) {
  			this.setStyle(style, value);
  			return resolved || (resolved = utils_Promise.resolve());
  		}

  		if (typeof style === "string") {
  			to = {};
  			to[style] = value;
  		} else {
  			to = style;

  			// shuffle arguments
  			options = value;
  		}

  		// As of 0.3.9, transition authors should supply an `option` object with
  		// `duration` and `easing` properties (and optional `delay`), plus a
  		// callback function that gets called after the animation completes

  		// TODO remove this check in a future version
  		if (!options) {
  			warnOnceIfDebug("The \"%s\" transition does not supply an options object to `t.animateStyle()`. This will break in a future version of Ractive. For more info see https://github.com/RactiveJS/Ractive/issues/340", this.name);
  			options = this;
  		}

  		var promise = new utils_Promise(function (resolve) {
  			var propertyNames, changedProperties, computedStyle, current, from, i, prop;

  			// Edge case - if duration is zero, set style synchronously and complete
  			if (!options.duration) {
  				_this.setStyle(to);
  				resolve();
  				return;
  			}

  			// Get a list of the properties we're animating
  			propertyNames = Object.keys(to);
  			changedProperties = [];

  			// Store the current styles
  			computedStyle = _animateStyle__getComputedStyle(_this.node);

  			from = {};
  			i = propertyNames.length;
  			while (i--) {
  				prop = propertyNames[i];
  				current = computedStyle[helpers_prefix(prop)];

  				if (current === "0px") {
  					current = 0;
  				}

  				// we need to know if we're actually changing anything
  				if (current != to[prop]) {
  					// use != instead of !==, so we can compare strings with numbers
  					changedProperties.push(prop);

  					// make the computed style explicit, so we can animate where
  					// e.g. height='auto'
  					_this.node.style[helpers_prefix(prop)] = current;
  				}
  			}

  			// If we're not actually changing anything, the transitionend event
  			// will never fire! So we complete early
  			if (!changedProperties.length) {
  				resolve();
  				return;
  			}

  			animateStyle_createTransitions(_this, to, options, changedProperties, resolve);
  		});

  		return promise;
  	};
  }

  var _animateStyle = animateStyle;

  var processParams = function (params, defaults) {
  	if (typeof params === "number") {
  		params = { duration: params };
  	} else if (typeof params === "string") {
  		if (params === "slow") {
  			params = { duration: 600 };
  		} else if (params === "fast") {
  			params = { duration: 200 };
  		} else {
  			params = { duration: 400 };
  		}
  	} else if (!params) {
  		params = {};
  	}

  	return fillGaps({}, params, defaults);
  };

  var prototype_start = Transition$start;

  function Transition$start() {
  	var _this = this;

  	var node, originalStyle, completed;

  	node = this.node = this.element.node;
  	originalStyle = node.getAttribute("style");

  	// create t.complete() - we don't want this on the prototype,
  	// because we don't want `this` silliness when passing it as
  	// an argument
  	this.complete = function (noReset) {
  		if (completed) {
  			return;
  		}

  		if (!noReset && _this.isIntro) {
  			resetStyle(node, originalStyle);
  		}

  		node._ractive.transition = null;
  		_this._manager.remove(_this);

  		completed = true;
  	};

  	// If the transition function doesn't exist, abort
  	if (!this._fn) {
  		this.complete();
  		return;
  	}

  	this._fn.apply(this.root, [this].concat(this.params));
  }

  function resetStyle(node, style) {
  	if (style) {
  		node.setAttribute("style", style);
  	} else {

  		// Next line is necessary, to remove empty style attribute!
  		// See http://stackoverflow.com/a/7167553
  		node.getAttribute("style");
  		node.removeAttribute("style");
  	}
  }

  var Transition = function (owner, template, isIntro) {
  	this.init(owner, template, isIntro);
  };

  Transition.prototype = {
  	init: Transition_prototype_init,
  	start: prototype_start,
  	getStyle: prototype_getStyle,
  	setStyle: setStyle,
  	animateStyle: _animateStyle,
  	processParams: processParams
  };

  var _Transition = Transition;

  var Element_prototype_render = Element$render;

  var updateCss, updateScript;

  updateCss = function () {
  	var node = this.node,
  	    content = this.fragment.toString(false);

  	// IE8 has no styleSheet unless there's a type text/css
  	if (window && window.appearsToBeIELessEqual8) {
  		node.type = "text/css";
  	}

  	if (node.styleSheet) {
  		node.styleSheet.cssText = content;
  	} else {

  		while (node.hasChildNodes()) {
  			node.removeChild(node.firstChild);
  		}

  		node.appendChild(document.createTextNode(content));
  	}
  };

  updateScript = function () {
  	if (!this.node.type || this.node.type === "text/javascript") {
  		warnIfDebug("Script tag was updated. This does not cause the code to be re-evaluated!", { ractive: this.root });
  		// As it happens, we ARE in a position to re-evaluate the code if we wanted
  		// to - we could eval() it, or insert it into a fresh (temporary) script tag.
  		// But this would be a terrible idea with unpredictable results, so let's not.
  	}

  	this.node.text = this.fragment.toString(false);
  };
  function Element$render() {
  	var _this = this;

  	var root = this.root,
  	    namespace,
  	    node,
  	    transition;

  	namespace = getNamespace(this);
  	node = this.node = createElement(this.name, namespace);

  	// Is this a top-level node of a component? If so, we may need to add
  	// a data-ractive-css attribute, for CSS encapsulation
  	if (this.parentFragment.cssIds) {
  		this.node.setAttribute("data-ractive-css", this.parentFragment.cssIds.map(function (x) {
  			return "{" + x + "}";
  		}).join(" "));
  	}

  	// Add _ractive property to the node - we use this object to store stuff
  	// related to proxy events, two-way bindings etc
  	defineProperty(this.node, "_ractive", {
  		value: {
  			proxy: this,
  			keypath: getInnerContext(this.parentFragment),
  			events: create(null),
  			root: root
  		}
  	});

  	// Render attributes
  	this.attributes.forEach(function (a) {
  		return a.render(node);
  	});
  	this.conditionalAttributes.forEach(function (a) {
  		return a.render(node);
  	});

  	// Render children
  	if (this.fragment) {
  		// Special case - <script> element
  		if (this.name === "script") {
  			this.bubble = updateScript;
  			this.node.text = this.fragment.toString(false); // bypass warning initially
  			this.fragment.unrender = noop; // TODO this is a kludge
  		}

  		// Special case - <style> element
  		else if (this.name === "style") {
  			this.bubble = updateCss;
  			this.bubble();
  			this.fragment.unrender = noop;
  		}

  		// Special case - contenteditable
  		else if (this.binding && this.getAttribute("contenteditable")) {
  			this.fragment.unrender = noop;
  		} else {
  			this.node.appendChild(this.fragment.render());
  		}
  	}

  	// deal with two-way bindings
  	if (this.binding) {
  		this.binding.render();
  		this.node._ractive.binding = this.binding;
  	}

  	// Add proxy event handlers
  	if (this.eventHandlers) {
  		this.eventHandlers.forEach(function (h) {
  			return h.render();
  		});
  	}

  	if (this.name === "option") {
  		processOption(this);
  	}

  	// Special cases
  	if (this.name === "img") {
  		// if this is an <img>, and we're in a crap browser, we may
  		// need to prevent it from overriding width and height when
  		// it loads the src
  		special_img__render(this);
  	} else if (this.name === "form") {
  		// forms need to keep track of their bindings, in case of reset
  		form__render(this);
  	} else if (this.name === "input" || this.name === "textarea") {
  		// inputs and textareas should store their initial value as
  		// `defaultValue` in case of reset
  		this.node.defaultValue = this.node.value;
  	} else if (this.name === "option") {
  		// similarly for option nodes
  		this.node.defaultSelected = this.node.selected;
  	}

  	// apply decorator(s)
  	if (this.decorator && this.decorator.fn) {
  		global_runloop.scheduleTask(function () {
  			if (!_this.decorator.torndown) {
  				_this.decorator.init();
  			}
  		}, true);
  	}

  	// trigger intro transition
  	if (root.transitionsEnabled && this.intro) {
  		transition = new _Transition(this, this.intro, true);
  		global_runloop.registerTransition(transition);
  		global_runloop.scheduleTask(function () {
  			return transition.start();
  		}, true);

  		this.transition = transition;
  	}

  	if (this.node.autofocus) {
  		// Special case. Some browsers (*cough* Firefix *cough*) have a problem
  		// with dynamically-generated elements having autofocus, and they won't
  		// allow you to programmatically focus the element until it's in the DOM
  		global_runloop.scheduleTask(function () {
  			return _this.node.focus();
  		}, true);
  	}

  	updateLiveQueries(this);
  	return this.node;
  }

  function getNamespace(element) {
  	var namespace, xmlns, parent;

  	// Use specified namespace...
  	if (xmlns = element.getAttribute("xmlns")) {
  		namespace = xmlns;
  	}

  	// ...or SVG namespace, if this is an <svg> element
  	else if (element.name === "svg") {
  		namespace = namespaces.svg;
  	} else if (parent = element.parent) {
  		// ...or HTML, if the parent is a <foreignObject>
  		if (parent.name === "foreignObject") {
  			namespace = namespaces.html;
  		}

  		// ...or inherit from the parent node
  		else {
  			namespace = parent.node.namespaceURI;
  		}
  	} else {
  		namespace = element.root.el.namespaceURI;
  	}

  	return namespace;
  }

  function processOption(option) {
  	var optionValue, selectValue, i;

  	if (!option.select) {
  		return;
  	}

  	selectValue = option.select.getAttribute("value");
  	if (selectValue === undefined) {
  		return;
  	}

  	optionValue = option.getAttribute("value");

  	if (option.select.node.multiple && isArray(selectValue)) {
  		i = selectValue.length;
  		while (i--) {
  			if (optionValue == selectValue[i]) {
  				option.node.selected = true;
  				break;
  			}
  		}
  	} else {
  		option.node.selected = optionValue == selectValue;
  	}
  }

  function updateLiveQueries(element) {
  	var instance, liveQueries, i, selector, query;

  	// Does this need to be added to any live queries?
  	instance = element.root;

  	do {
  		liveQueries = instance._liveQueries;

  		i = liveQueries.length;
  		while (i--) {
  			selector = liveQueries[i];
  			query = liveQueries["_" + selector];

  			if (query._test(element)) {
  				// keep register of applicable selectors, for when we teardown
  				(element.liveQueries || (element.liveQueries = [])).push(query);
  			}
  		}
  	} while (instance = instance.parent);
  }

  var Element_prototype_toString = function () {
  	var str, escape;

  	if (this.template.y) {
  		// DOCTYPE declaration
  		return "<!DOCTYPE" + this.template.dd + ">";
  	}

  	str = "<" + this.template.e;

  	str += this.attributes.map(stringifyAttribute).join("") + this.conditionalAttributes.map(stringifyAttribute).join("");

  	// Special case - selected options
  	if (this.name === "option" && optionIsSelected(this)) {
  		str += " selected";
  	}

  	// Special case - two-way radio name bindings
  	if (this.name === "input" && inputIsCheckedRadio(this)) {
  		str += " checked";
  	}

  	str += ">";

  	// Special case - textarea
  	if (this.name === "textarea" && this.getAttribute("value") !== undefined) {
  		str += escapeHtml(this.getAttribute("value"));
  	}

  	// Special case - contenteditable
  	else if (this.getAttribute("contenteditable") !== undefined) {
  		str += this.getAttribute("value") || "";
  	}

  	if (this.fragment) {
  		escape = this.name !== "script" && this.name !== "style";
  		str += this.fragment.toString(escape);
  	}

  	// add a closing tag if this isn't a void element
  	if (!voidElementNames.test(this.template.e)) {
  		str += "</" + this.template.e + ">";
  	}

  	return str;
  };

  function optionIsSelected(element) {
  	var optionValue, selectValue, i;

  	optionValue = element.getAttribute("value");

  	if (optionValue === undefined || !element.select) {
  		return false;
  	}

  	selectValue = element.select.getAttribute("value");

  	if (selectValue == optionValue) {
  		return true;
  	}

  	if (element.select.getAttribute("multiple") && isArray(selectValue)) {
  		i = selectValue.length;
  		while (i--) {
  			if (selectValue[i] == optionValue) {
  				return true;
  			}
  		}
  	}
  }

  function inputIsCheckedRadio(element) {
  	var attributes, typeAttribute, valueAttribute, nameAttribute;

  	attributes = element.attributes;

  	typeAttribute = attributes.type;
  	valueAttribute = attributes.value;
  	nameAttribute = attributes.name;

  	if (!typeAttribute || typeAttribute.value !== "radio" || !valueAttribute || !nameAttribute.interpolator) {
  		return;
  	}

  	if (valueAttribute.value === nameAttribute.interpolator.value) {
  		return true;
  	}
  }

  function stringifyAttribute(attribute) {
  	var str = attribute.toString();
  	return str ? " " + str : "";
  }

  var Element_prototype_unbind = Element$unbind;
  function Element$unbind() {
  	if (this.fragment) {
  		this.fragment.unbind();
  	}

  	if (this.binding) {
  		this.binding.unbind();
  	}

  	if (this.eventHandlers) {
  		this.eventHandlers.forEach(methodCallers__unbind);
  	}

  	// Special case - <option>
  	if (this.name === "option") {
  		special_option__unbind(this);
  	}

  	this.attributes.forEach(methodCallers__unbind);
  	this.conditionalAttributes.forEach(methodCallers__unbind);
  }

  var Element_prototype_unrender = Element$unrender;

  function Element$unrender(shouldDestroy) {
  	var binding, bindings, transition;

  	if (transition = this.transition) {
  		transition.complete();
  	}

  	// Detach as soon as we can
  	if (this.name === "option") {
  		// <option> elements detach immediately, so that
  		// their parent <select> element syncs correctly, and
  		// since option elements can't have transitions anyway
  		this.detach();
  	} else if (shouldDestroy) {
  		global_runloop.detachWhenReady(this);
  	}

  	// Children first. that way, any transitions on child elements will be
  	// handled by the current transitionManager
  	if (this.fragment) {
  		this.fragment.unrender(false);
  	}

  	if (binding = this.binding) {
  		this.binding.unrender();

  		this.node._ractive.binding = null;
  		bindings = this.root._twowayBindings[binding.keypath.str];
  		bindings.splice(bindings.indexOf(binding), 1);
  	}

  	// Remove event handlers
  	if (this.eventHandlers) {
  		this.eventHandlers.forEach(methodCallers__unrender);
  	}

  	if (this.decorator) {
  		global_runloop.registerDecorator(this.decorator);
  	}

  	// trigger outro transition if necessary
  	if (this.root.transitionsEnabled && this.outro) {
  		transition = new _Transition(this, this.outro, false);
  		global_runloop.registerTransition(transition);
  		global_runloop.scheduleTask(function () {
  			return transition.start();
  		});
  	}

  	// Remove this node from any live queries
  	if (this.liveQueries) {
  		removeFromLiveQueries(this);
  	}

  	if (this.name === "form") {
  		form__unrender(this);
  	}
  }

  function removeFromLiveQueries(element) {
  	var query, selector, i;

  	i = element.liveQueries.length;
  	while (i--) {
  		query = element.liveQueries[i];
  		selector = query.selector;

  		query._remove(element.node);
  	}
  }

  var Element = function (options) {
  	this.init(options);
  };

  Element.prototype = {
  	bubble: Element_prototype_bubble,
  	detach: Element_prototype_detach,
  	find: Element_prototype_find,
  	findAll: Element_prototype_findAll,
  	findAllComponents: Element_prototype_findAllComponents,
  	findComponent: Element_prototype_findComponent,
  	findNextNode: Element_prototype_findNextNode,
  	firstNode: Element_prototype_firstNode,
  	getAttribute: getAttribute,
  	init: Element_prototype_init,
  	rebind: Element_prototype_rebind,
  	render: Element_prototype_render,
  	toString: Element_prototype_toString,
  	unbind: Element_prototype_unbind,
  	unrender: Element_prototype_unrender
  };

  var _Element = Element;

  var deIndent__empty = /^\s*$/,
      deIndent__leadingWhitespace = /^\s*/;

  var deIndent = function (str) {
  	var lines, firstLine, lastLine, minIndent;

  	lines = str.split("\n");

  	// remove first and last line, if they only contain whitespace
  	firstLine = lines[0];
  	if (firstLine !== undefined && deIndent__empty.test(firstLine)) {
  		lines.shift();
  	}

  	lastLine = lastItem(lines);
  	if (lastLine !== undefined && deIndent__empty.test(lastLine)) {
  		lines.pop();
  	}

  	minIndent = lines.reduce(reducer, null);

  	if (minIndent) {
  		str = lines.map(function (line) {
  			return line.replace(minIndent, "");
  		}).join("\n");
  	}

  	return str;
  };

  function reducer(previous, line) {
  	var lineIndent = deIndent__leadingWhitespace.exec(line)[0];

  	if (previous === null || lineIndent.length < previous.length) {
  		return lineIndent;
  	}

  	return previous;
  }

  var Partial_getPartialTemplate = getPartialTemplate;

  function getPartialTemplate(ractive, name, parentFragment) {
  	var partial;

  	// If the partial in instance or view heirarchy instances, great
  	if (partial = getPartialFromRegistry(ractive, name, parentFragment || {})) {
  		return partial;
  	}

  	// Does it exist on the page as a script tag?
  	partial = template_parser.fromId(name, { noThrow: true });

  	if (partial) {
  		// is this necessary?
  		partial = deIndent(partial);

  		// parse and register to this ractive instance
  		var parsed = template_parser.parse(partial, template_parser.getParseOptions(ractive));

  		// register (and return main partial if there are others in the template)
  		return ractive.partials[name] = parsed.t;
  	}
  }

  function getPartialFromRegistry(ractive, name, parentFragment) {
  	var fn = undefined,
  	    partial = findParentPartial(name, parentFragment.owner);

  	// if there was an instance up-hierarchy, cool
  	if (partial) return partial;

  	// find first instance in the ractive or view hierarchy that has this partial
  	var instance = findInstance("partials", ractive, name);

  	if (!instance) {
  		return;
  	}

  	partial = instance.partials[name];

  	// partial is a function?
  	if (typeof partial === "function") {
  		fn = partial.bind(instance);
  		fn.isOwner = instance.partials.hasOwnProperty(name);
  		partial = fn.call(ractive, template_parser);
  	}

  	if (!partial && partial !== "") {
  		warnIfDebug(noRegistryFunctionReturn, name, "partial", "partial", { ractive: ractive });
  		return;
  	}

  	// If this was added manually to the registry,
  	// but hasn't been parsed, parse it now
  	if (!template_parser.isParsed(partial)) {

  		// use the parseOptions of the ractive instance on which it was found
  		var parsed = template_parser.parse(partial, template_parser.getParseOptions(instance));

  		// Partials cannot contain nested partials!
  		// TODO add a test for this
  		if (parsed.p) {
  			warnIfDebug("Partials ({{>%s}}) cannot contain nested inline partials", name, { ractive: ractive });
  		}

  		// if fn, use instance to store result, otherwise needs to go
  		// in the correct point in prototype chain on instance or constructor
  		var target = fn ? instance : findOwner(instance, name);

  		// may be a template with partials, which need to be registered and main template extracted
  		target.partials[name] = partial = parsed.t;
  	}

  	// store for reset
  	if (fn) {
  		partial._fn = fn;
  	}

  	return partial.v ? partial.t : partial;
  }

  function findOwner(ractive, key) {
  	return ractive.partials.hasOwnProperty(key) ? ractive : findConstructor(ractive.constructor, key);
  }

  function findConstructor(constructor, key) {
  	if (!constructor) {
  		return;
  	}
  	return constructor.partials.hasOwnProperty(key) ? constructor : findConstructor(constructor._Parent, key);
  }

  function findParentPartial(name, parent) {
  	if (parent) {
  		if (parent.template && parent.template.p && parent.template.p[name]) {
  			return parent.template.p[name];
  		} else if (parent.parentFragment && parent.parentFragment.owner) {
  			return findParentPartial(name, parent.parentFragment.owner);
  		}
  	}
  }

  var applyIndent = function (string, indent) {
  	var indented;

  	if (!indent) {
  		return string;
  	}

  	indented = string.split("\n").map(function (line, notFirstLine) {
  		return notFirstLine ? indent + line : line;
  	}).join("\n");

  	return indented;
  };

  var missingPartialMessage = "Could not find template for partial \"%s\"";

  var Partial = function (options) {
  	var parentFragment, template;

  	parentFragment = this.parentFragment = options.parentFragment;

  	this.root = parentFragment.root;
  	this.type = PARTIAL;
  	this.index = options.index;
  	this.name = options.template.r;
  	this.rendered = false;

  	this.fragment = this.fragmentToRender = this.fragmentToUnrender = null;

  	Mustache.init(this, options);

  	// If this didn't resolve, it most likely means we have a named partial
  	// (i.e. `{{>foo}}` means 'use the foo partial', not 'use the partial
  	// whose name is the value of `foo`')
  	if (!this.keypath) {
  		if (template = Partial_getPartialTemplate(this.root, this.name, parentFragment)) {
  			shared_unbind.call(this); // prevent any further changes
  			this.isNamed = true;
  			this.setTemplate(template);
  		} else {
  			warnOnceIfDebug(missingPartialMessage, this.name);
  		}
  	}
  };

  Partial.prototype = {
  	bubble: function () {
  		this.parentFragment.bubble();
  	},

  	detach: function () {
  		return this.fragment.detach();
  	},

  	find: function (selector) {
  		return this.fragment.find(selector);
  	},

  	findAll: function (selector, query) {
  		return this.fragment.findAll(selector, query);
  	},

  	findComponent: function (selector) {
  		return this.fragment.findComponent(selector);
  	},

  	findAllComponents: function (selector, query) {
  		return this.fragment.findAllComponents(selector, query);
  	},

  	firstNode: function () {
  		return this.fragment.firstNode();
  	},

  	findNextNode: function () {
  		return this.parentFragment.findNextNode(this);
  	},

  	getPartialName: function () {
  		if (this.isNamed && this.name) return this.name;else if (this.value === undefined) return this.name;else return this.value;
  	},

  	getValue: function () {
  		return this.fragment.getValue();
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		// named partials aren't bound, so don't rebind
  		if (!this.isNamed) {
  			Mustache_rebind.call(this, oldKeypath, newKeypath);
  		}

  		if (this.fragment) {
  			this.fragment.rebind(oldKeypath, newKeypath);
  		}
  	},

  	render: function () {
  		this.docFrag = document.createDocumentFragment();
  		this.update();

  		this.rendered = true;
  		return this.docFrag;
  	},

  	resolve: Mustache.resolve,

  	setValue: function (value) {
  		var template;

  		if (value !== undefined && value === this.value) {
  			// nothing has changed, so no work to be done
  			return;
  		}

  		if (value !== undefined) {
  			template = Partial_getPartialTemplate(this.root, "" + value, this.parentFragment);
  		}

  		// we may be here if we have a partial like `{{>foo}}` and `foo` is the
  		// name of both a data property (whose value ISN'T the name of a partial)
  		// and a partial. In those cases, this becomes a named partial
  		if (!template && this.name && (template = Partial_getPartialTemplate(this.root, this.name, this.parentFragment))) {
  			shared_unbind.call(this);
  			this.isNamed = true;
  		}

  		if (!template) {
  			warnOnceIfDebug(missingPartialMessage, this.name, { ractive: this.root });
  		}

  		this.value = value;

  		this.setTemplate(template || []);

  		this.bubble();

  		if (this.rendered) {
  			global_runloop.addView(this);
  		}
  	},

  	setTemplate: function (template) {
  		if (this.fragment) {
  			this.fragment.unbind();
  			if (this.rendered) {
  				this.fragmentToUnrender = this.fragment;
  			}
  		}

  		this.fragment = new virtualdom_Fragment({
  			template: template,
  			root: this.root,
  			owner: this,
  			pElement: this.parentFragment.pElement
  		});

  		this.fragmentToRender = this.fragment;
  	},

  	toString: function (toString) {
  		var string, previousItem, lastLine, match;

  		string = this.fragment.toString(toString);

  		previousItem = this.parentFragment.items[this.index - 1];

  		if (!previousItem || previousItem.type !== TEXT) {
  			return string;
  		}

  		lastLine = previousItem.text.split("\n").pop();

  		if (match = /^\s+$/.exec(lastLine)) {
  			return applyIndent(string, match[0]);
  		}

  		return string;
  	},

  	unbind: function () {
  		if (!this.isNamed) {
  			// dynamic partial - need to unbind self
  			shared_unbind.call(this);
  		}

  		if (this.fragment) {
  			this.fragment.unbind();
  		}
  	},

  	unrender: function (shouldDestroy) {
  		if (this.rendered) {
  			if (this.fragment) {
  				this.fragment.unrender(shouldDestroy);
  			}
  			this.rendered = false;
  		}
  	},

  	update: function () {
  		var target, anchor;

  		if (this.fragmentToUnrender) {
  			this.fragmentToUnrender.unrender(true);
  			this.fragmentToUnrender = null;
  		}

  		if (this.fragmentToRender) {
  			this.docFrag.appendChild(this.fragmentToRender.render());
  			this.fragmentToRender = null;
  		}

  		if (this.rendered) {
  			target = this.parentFragment.getNode();
  			anchor = this.parentFragment.findNextNode(this);
  			target.insertBefore(this.docFrag, anchor);
  		}
  	}
  };

  var _Partial = Partial;

  // finds the component constructor in the registry or view hierarchy registries

  var Component_getComponent = getComponent;
  function getComponent(ractive, name) {

  	var Component,
  	    instance = findInstance("components", ractive, name);

  	if (instance) {
  		Component = instance.components[name];

  		// best test we have for not Ractive.extend
  		if (!Component._Parent) {
  			// function option, execute and store for reset
  			var fn = Component.bind(instance);
  			fn.isOwner = instance.components.hasOwnProperty(name);
  			Component = fn();

  			if (!Component) {
  				warnIfDebug(noRegistryFunctionReturn, name, "component", "component", { ractive: ractive });

  				return;
  			}

  			if (typeof Component === "string") {
  				// allow string lookup
  				Component = getComponent(ractive, Component);
  			}

  			Component._fn = fn;
  			instance.components[name] = Component;
  		}
  	}

  	return Component;
  }

  var Component_prototype_detach = Component$detach;
  var Component_prototype_detach__detachHook = new hooks_Hook("detach");
  function Component$detach() {
  	var detached = this.instance.fragment.detach();
  	Component_prototype_detach__detachHook.fire(this.instance);
  	return detached;
  }

  var Component_prototype_find = Component$find;

  function Component$find(selector) {
  	return this.instance.fragment.find(selector);
  }

  var Component_prototype_findAll = Component$findAll;

  function Component$findAll(selector, query) {
  	return this.instance.fragment.findAll(selector, query);
  }

  var Component_prototype_findAllComponents = Component$findAllComponents;

  function Component$findAllComponents(selector, query) {
  	query._test(this, true);

  	if (this.instance.fragment) {
  		this.instance.fragment.findAllComponents(selector, query);
  	}
  }

  var Component_prototype_findComponent = Component$findComponent;

  function Component$findComponent(selector) {
  	if (!selector || selector === this.name) {
  		return this.instance;
  	}

  	if (this.instance.fragment) {
  		return this.instance.fragment.findComponent(selector);
  	}

  	return null;
  }

  var Component_prototype_findNextNode = Component$findNextNode;

  function Component$findNextNode() {
  	return this.parentFragment.findNextNode(this);
  }

  var Component_prototype_firstNode = Component$firstNode;

  function Component$firstNode() {
  	if (this.rendered) {
  		return this.instance.fragment.firstNode();
  	}

  	return null;
  }

  var processWrapper = function (wrapper, array, methodName, newIndices) {
  	var root = wrapper.root;
  	var keypath = wrapper.keypath;

  	if (!!newIndices) {
  		root.viewmodel.smartUpdate(keypath, array, newIndices);
  	} else {
  		// If this is a sort or reverse, we just do root.set()...
  		// TODO use merge logic?
  		root.viewmodel.mark(keypath);
  	}
  };

  var patchedArrayProto = [],
      mutatorMethods = ["pop", "push", "reverse", "shift", "sort", "splice", "unshift"],
      testObj,
      patchArrayMethods,
      unpatchArrayMethods;

  mutatorMethods.forEach(function (methodName) {
  	var method = function () {
  		for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
  			args[_key] = arguments[_key];
  		}

  		var newIndices, result, wrapper, i;

  		newIndices = shared_getNewIndices(this, methodName, args);

  		// apply the underlying method
  		result = Array.prototype[methodName].apply(this, arguments);

  		// trigger changes
  		global_runloop.start();

  		this._ractive.setting = true;
  		i = this._ractive.wrappers.length;
  		while (i--) {
  			wrapper = this._ractive.wrappers[i];

  			global_runloop.addRactive(wrapper.root);
  			processWrapper(wrapper, this, methodName, newIndices);
  		}

  		global_runloop.end();

  		this._ractive.setting = false;
  		return result;
  	};

  	defineProperty(patchedArrayProto, methodName, {
  		value: method
  	});
  });

  // can we use prototype chain injection?
  // http://perfectionkills.com/how-ecmascript-5-still-does-not-allow-to-subclass-an-array/#wrappers_prototype_chain_injection
  testObj = {};

  if (testObj.__proto__) {
  	// yes, we can
  	patchArrayMethods = function (array) {
  		array.__proto__ = patchedArrayProto;
  	};

  	unpatchArrayMethods = function (array) {
  		array.__proto__ = Array.prototype;
  	};
  } else {
  	// no, we can't
  	patchArrayMethods = function (array) {
  		var i, methodName;

  		i = mutatorMethods.length;
  		while (i--) {
  			methodName = mutatorMethods[i];
  			defineProperty(array, methodName, {
  				value: patchedArrayProto[methodName],
  				configurable: true
  			});
  		}
  	};

  	unpatchArrayMethods = function (array) {
  		var i;

  		i = mutatorMethods.length;
  		while (i--) {
  			delete array[mutatorMethods[i]];
  		}
  	};
  }

  patchArrayMethods.unpatch = unpatchArrayMethods;
  var patch = patchArrayMethods;

  var arrayAdaptor,

  // helpers
  ArrayWrapper, array_index__errorMessage;

  arrayAdaptor = {
  	filter: function (object) {
  		// wrap the array if a) b) it's an array, and b) either it hasn't been wrapped already,
  		// or the array didn't trigger the get() itself
  		return isArray(object) && (!object._ractive || !object._ractive.setting);
  	},
  	wrap: function (ractive, array, keypath) {
  		return new ArrayWrapper(ractive, array, keypath);
  	}
  };

  ArrayWrapper = function (ractive, array, keypath) {
  	this.root = ractive;
  	this.value = array;
  	this.keypath = getKeypath(keypath);

  	// if this array hasn't already been ractified, ractify it
  	if (!array._ractive) {

  		// define a non-enumerable _ractive property to store the wrappers
  		defineProperty(array, "_ractive", {
  			value: {
  				wrappers: [],
  				instances: [],
  				setting: false
  			},
  			configurable: true
  		});

  		patch(array);
  	}

  	// store the ractive instance, so we can handle transitions later
  	if (!array._ractive.instances[ractive._guid]) {
  		array._ractive.instances[ractive._guid] = 0;
  		array._ractive.instances.push(ractive);
  	}

  	array._ractive.instances[ractive._guid] += 1;
  	array._ractive.wrappers.push(this);
  };

  ArrayWrapper.prototype = {
  	get: function () {
  		return this.value;
  	},
  	teardown: function () {
  		var array, storage, wrappers, instances, index;

  		array = this.value;
  		storage = array._ractive;
  		wrappers = storage.wrappers;
  		instances = storage.instances;

  		// if teardown() was invoked because we're clearing the cache as a result of
  		// a change that the array itself triggered, we can save ourselves the teardown
  		// and immediate setup
  		if (storage.setting) {
  			return false; // so that we don't remove it from this.root.viewmodel.wrapped
  		}

  		index = wrappers.indexOf(this);
  		if (index === -1) {
  			throw new Error(array_index__errorMessage);
  		}

  		wrappers.splice(index, 1);

  		// if nothing else depends on this array, we can revert it to its
  		// natural state
  		if (!wrappers.length) {
  			delete array._ractive;
  			patch.unpatch(this.value);
  		} else {
  			// remove ractive instance if possible
  			instances[this.root._guid] -= 1;
  			if (!instances[this.root._guid]) {
  				index = instances.indexOf(this.root);

  				if (index === -1) {
  					throw new Error(array_index__errorMessage);
  				}

  				instances.splice(index, 1);
  			}
  		}
  	}
  };

  array_index__errorMessage = "Something went wrong in a rather interesting way";
  var array_index = arrayAdaptor;

  var numeric = /^\s*[0-9]+\s*$/;

  var createBranch = function (key) {
  	return numeric.test(key) ? [] : {};
  };

  var magicAdaptor, MagicWrapper;

  try {
  	Object.defineProperty({}, "test", { value: 0 });

  	magicAdaptor = {
  		filter: function (object, keypath, ractive) {
  			var parentWrapper, parentValue;

  			if (!keypath) {
  				return false;
  			}

  			keypath = getKeypath(keypath);

  			// If the parent value is a wrapper, other than a magic wrapper,
  			// we shouldn't wrap this property
  			if ((parentWrapper = ractive.viewmodel.wrapped[keypath.parent.str]) && !parentWrapper.magic) {
  				return false;
  			}

  			parentValue = ractive.viewmodel.get(keypath.parent);

  			// if parentValue is an array that doesn't include this member,
  			// we should return false otherwise lengths will get messed up
  			if (isArray(parentValue) && /^[0-9]+$/.test(keypath.lastKey)) {
  				return false;
  			}

  			return parentValue && (typeof parentValue === "object" || typeof parentValue === "function");
  		},
  		wrap: function (ractive, property, keypath) {
  			return new MagicWrapper(ractive, property, keypath);
  		}
  	};

  	MagicWrapper = function (ractive, value, keypath) {
  		var objKeypath, template, siblings;

  		keypath = getKeypath(keypath);

  		this.magic = true;

  		this.ractive = ractive;
  		this.keypath = keypath;
  		this.value = value;

  		this.prop = keypath.lastKey;

  		objKeypath = keypath.parent;
  		this.obj = objKeypath.isRoot ? ractive.viewmodel.data : ractive.viewmodel.get(objKeypath);

  		template = this.originalDescriptor = Object.getOwnPropertyDescriptor(this.obj, this.prop);

  		// Has this property already been wrapped?
  		if (template && template.set && (siblings = template.set._ractiveWrappers)) {

  			// Yes. Register this wrapper to this property, if it hasn't been already
  			if (siblings.indexOf(this) === -1) {
  				siblings.push(this);
  			}

  			return; // already wrapped
  		}

  		// No, it hasn't been wrapped
  		createAccessors(this, value, template);
  	};

  	MagicWrapper.prototype = {
  		get: function () {
  			return this.value;
  		},
  		reset: function (value) {
  			if (this.updating) {
  				return;
  			}

  			this.updating = true;
  			this.obj[this.prop] = value; // trigger set() accessor
  			global_runloop.addRactive(this.ractive);
  			this.ractive.viewmodel.mark(this.keypath, { keepExistingWrapper: true });
  			this.updating = false;
  			return true;
  		},
  		set: function (key, value) {
  			if (this.updating) {
  				return;
  			}

  			if (!this.obj[this.prop]) {
  				this.updating = true;
  				this.obj[this.prop] = createBranch(key);
  				this.updating = false;
  			}

  			this.obj[this.prop][key] = value;
  		},
  		teardown: function () {
  			var template, set, value, wrappers, index;

  			// If this method was called because the cache was being cleared as a
  			// result of a set()/update() call made by this wrapper, we return false
  			// so that it doesn't get torn down
  			if (this.updating) {
  				return false;
  			}

  			template = Object.getOwnPropertyDescriptor(this.obj, this.prop);
  			set = template && template.set;

  			if (!set) {
  				// most likely, this was an array member that was spliced out
  				return;
  			}

  			wrappers = set._ractiveWrappers;

  			index = wrappers.indexOf(this);
  			if (index !== -1) {
  				wrappers.splice(index, 1);
  			}

  			// Last one out, turn off the lights
  			if (!wrappers.length) {
  				value = this.obj[this.prop];

  				Object.defineProperty(this.obj, this.prop, this.originalDescriptor || {
  					writable: true,
  					enumerable: true,
  					configurable: true
  				});

  				this.obj[this.prop] = value;
  			}
  		}
  	};
  } catch (err) {
  	magicAdaptor = false; // no magic in this browser
  }

  var adaptors_magic = magicAdaptor;

  function createAccessors(originalWrapper, value, template) {

  	var object, property, oldGet, oldSet, get, set;

  	object = originalWrapper.obj;
  	property = originalWrapper.prop;

  	// Is this template configurable?
  	if (template && !template.configurable) {
  		// Special case - array length
  		if (property === "length") {
  			return;
  		}

  		throw new Error("Cannot use magic mode with property \"" + property + "\" - object is not configurable");
  	}

  	// Time to wrap this property
  	if (template) {
  		oldGet = template.get;
  		oldSet = template.set;
  	}

  	get = oldGet || function () {
  		return value;
  	};

  	set = function (v) {
  		if (oldSet) {
  			oldSet(v);
  		}

  		value = oldGet ? oldGet() : v;
  		set._ractiveWrappers.forEach(updateWrapper);
  	};

  	function updateWrapper(wrapper) {
  		var keypath, ractive;

  		wrapper.value = value;

  		if (wrapper.updating) {
  			return;
  		}

  		ractive = wrapper.ractive;
  		keypath = wrapper.keypath;

  		wrapper.updating = true;
  		global_runloop.start(ractive);

  		ractive.viewmodel.mark(keypath);

  		global_runloop.end();
  		wrapper.updating = false;
  	}

  	// Create an array of wrappers, in case other keypaths/ractives depend on this property.
  	// Handily, we can store them as a property of the set function. Yay JavaScript.
  	set._ractiveWrappers = [originalWrapper];
  	Object.defineProperty(object, property, { get: get, set: set, enumerable: true, configurable: true });
  }

  var magicArrayAdaptor, MagicArrayWrapper;

  if (adaptors_magic) {
  	magicArrayAdaptor = {
  		filter: function (object, keypath, ractive) {
  			return adaptors_magic.filter(object, keypath, ractive) && array_index.filter(object);
  		},

  		wrap: function (ractive, array, keypath) {
  			return new MagicArrayWrapper(ractive, array, keypath);
  		}
  	};

  	MagicArrayWrapper = function (ractive, array, keypath) {
  		this.value = array;

  		this.magic = true;

  		this.magicWrapper = adaptors_magic.wrap(ractive, array, keypath);
  		this.arrayWrapper = array_index.wrap(ractive, array, keypath);
  	};

  	MagicArrayWrapper.prototype = {
  		get: function () {
  			return this.value;
  		},
  		teardown: function () {
  			this.arrayWrapper.teardown();
  			this.magicWrapper.teardown();
  		},
  		reset: function (value) {
  			return this.magicWrapper.reset(value);
  		}
  	};
  }

  var magicArray = magicArrayAdaptor;

  var prototype_adapt = Viewmodel$adapt;

  var prefixers = {};
  function Viewmodel$adapt(keypath, value) {
  	var len, i, adaptor, wrapped;

  	if (!this.adaptors) return;

  	// Do we have an adaptor for this value?
  	len = this.adaptors.length;
  	for (i = 0; i < len; i += 1) {
  		adaptor = this.adaptors[i];

  		if (adaptor.filter(value, keypath, this.ractive)) {
  			wrapped = this.wrapped[keypath] = adaptor.wrap(this.ractive, value, keypath, getPrefixer(keypath));
  			wrapped.value = value;
  			return;
  		}
  	}
  }

  function prefixKeypath(obj, prefix) {
  	var prefixed = {},
  	    key;

  	if (!prefix) {
  		return obj;
  	}

  	prefix += ".";

  	for (key in obj) {
  		if (obj.hasOwnProperty(key)) {
  			prefixed[prefix + key] = obj[key];
  		}
  	}

  	return prefixed;
  }

  function getPrefixer(rootKeypath) {
  	var rootDot;

  	if (!prefixers[rootKeypath]) {
  		rootDot = rootKeypath ? rootKeypath + "." : "";

  		prefixers[rootKeypath] = function (relativeKeypath, value) {
  			var obj;

  			if (typeof relativeKeypath === "string") {
  				obj = {};
  				obj[rootDot + relativeKeypath] = value;
  				return obj;
  			}

  			if (typeof relativeKeypath === "object") {
  				// 'relativeKeypath' is in fact a hash, not a keypath
  				return rootDot ? prefixKeypath(relativeKeypath, rootKeypath) : relativeKeypath;
  			}
  		};
  	}

  	return prefixers[rootKeypath];
  }

  // TEMP

  var helpers_getUpstreamChanges = getUpstreamChanges;
  function getUpstreamChanges(changes) {
  	var upstreamChanges = [rootKeypath],
  	    i,
  	    keypath;

  	i = changes.length;
  	while (i--) {
  		keypath = changes[i].parent;

  		while (keypath && !keypath.isRoot) {
  			if (changes.indexOf(keypath) === -1) {
  				addToArray(upstreamChanges, keypath);
  			}
  			keypath = keypath.parent;
  		}
  	}

  	return upstreamChanges;
  }

  var applyChanges_notifyPatternObservers = notifyPatternObservers;

  function notifyPatternObservers(viewmodel, keypath, onlyDirect) {
  	var potentialWildcardMatches;

  	updateMatchingPatternObservers(viewmodel, keypath);

  	if (onlyDirect) {
  		return;
  	}

  	potentialWildcardMatches = keypath.wildcardMatches();
  	potentialWildcardMatches.forEach(function (upstreamPattern) {
  		cascade(viewmodel, upstreamPattern, keypath);
  	});
  }

  function cascade(viewmodel, upstreamPattern, keypath) {
  	var group, map, actualChildKeypath;

  	// TODO should be one or the other
  	upstreamPattern = upstreamPattern.str || upstreamPattern;

  	group = viewmodel.depsMap.patternObservers;
  	map = group && group[upstreamPattern];

  	if (!map) {
  		return;
  	}

  	map.forEach(function (childKeypath) {
  		actualChildKeypath = keypath.join(childKeypath.lastKey); // 'foo.bar.baz'

  		updateMatchingPatternObservers(viewmodel, actualChildKeypath);
  		cascade(viewmodel, childKeypath, actualChildKeypath);
  	});
  }

  function updateMatchingPatternObservers(viewmodel, keypath) {
  	viewmodel.patternObservers.forEach(function (observer) {
  		if (observer.regex.test(keypath.str)) {
  			observer.update(keypath);
  		}
  	});
  }

  var applyChanges = Viewmodel$applyChanges;

  function Viewmodel$applyChanges() {
  	var _this = this;

  	var self = this,
  	    changes,
  	    upstreamChanges,
  	    hash = {},
  	    bindings;

  	changes = this.changes;

  	if (!changes.length) {
  		// TODO we end up here on initial render. Perhaps we shouldn't?
  		return;
  	}

  	function invalidateComputation(computation) {
  		var key = computation.key;

  		if (computation.viewmodel === self) {
  			self.clearCache(key.str);
  			computation.invalidate();

  			changes.push(key);
  			cascade(key);
  		} else {
  			computation.viewmodel.mark(key);
  		}
  	}

  	function cascade(keypath) {
  		var map, computations;

  		if (self.noCascade.hasOwnProperty(keypath.str)) {
  			return;
  		}

  		if (computations = self.deps.computed[keypath.str]) {
  			computations.forEach(invalidateComputation);
  		}

  		if (map = self.depsMap.computed[keypath.str]) {
  			map.forEach(cascade);
  		}
  	}

  	changes.slice().forEach(cascade);

  	upstreamChanges = helpers_getUpstreamChanges(changes);
  	upstreamChanges.forEach(function (keypath) {
  		var computations;

  		// make sure we haven't already been down this particular keypath in this turn
  		if (changes.indexOf(keypath) === -1 && (computations = self.deps.computed[keypath.str])) {
  			computations.forEach(invalidateComputation);
  		}
  	});

  	this.changes = [];

  	// Pattern observers are a weird special case
  	if (this.patternObservers.length) {
  		upstreamChanges.forEach(function (keypath) {
  			return applyChanges_notifyPatternObservers(_this, keypath, true);
  		});
  		changes.forEach(function (keypath) {
  			return applyChanges_notifyPatternObservers(_this, keypath);
  		});
  	}

  	if (this.deps.observers) {
  		upstreamChanges.forEach(function (keypath) {
  			return notifyUpstreamDependants(_this, null, keypath, "observers");
  		});
  		notifyAllDependants(this, changes, "observers");
  	}

  	if (this.deps["default"]) {
  		bindings = [];
  		upstreamChanges.forEach(function (keypath) {
  			return notifyUpstreamDependants(_this, bindings, keypath, "default");
  		});

  		if (bindings.length) {
  			notifyBindings(this, bindings, changes);
  		}

  		notifyAllDependants(this, changes, "default");
  	}

  	// Return a hash of keypaths to updated values
  	changes.forEach(function (keypath) {
  		hash[keypath.str] = _this.get(keypath);
  	});

  	this.implicitChanges = {};
  	this.noCascade = {};

  	return hash;
  }

  function notifyUpstreamDependants(viewmodel, bindings, keypath, groupName) {
  	var dependants, value;

  	if (dependants = findDependants(viewmodel, keypath, groupName)) {
  		value = viewmodel.get(keypath);

  		dependants.forEach(function (d) {
  			// don't "set" the parent value, refine it
  			// i.e. not data = value, but data[foo] = fooValue
  			if (bindings && d.refineValue) {
  				bindings.push(d);
  			} else {
  				d.setValue(value);
  			}
  		});
  	}
  }

  function notifyBindings(viewmodel, bindings, changes) {

  	bindings.forEach(function (binding) {
  		var useSet = false,
  		    i = 0,
  		    length = changes.length,
  		    refinements = [];

  		while (i < length) {
  			var keypath = changes[i];

  			if (keypath === binding.keypath) {
  				useSet = true;
  				break;
  			}

  			if (keypath.slice(0, binding.keypath.length) === binding.keypath) {
  				refinements.push(keypath);
  			}

  			i++;
  		}

  		if (useSet) {
  			binding.setValue(viewmodel.get(binding.keypath));
  		}

  		if (refinements.length) {
  			binding.refineValue(refinements);
  		}
  	});
  }

  function notifyAllDependants(viewmodel, keypaths, groupName) {
  	var queue = [];

  	addKeypaths(keypaths);
  	queue.forEach(dispatch);

  	function addKeypaths(keypaths) {
  		keypaths.forEach(addKeypath);
  		keypaths.forEach(cascade);
  	}

  	function addKeypath(keypath) {
  		var deps = findDependants(viewmodel, keypath, groupName);

  		if (deps) {
  			queue.push({
  				keypath: keypath,
  				deps: deps
  			});
  		}
  	}

  	function cascade(keypath) {
  		var childDeps;

  		if (childDeps = viewmodel.depsMap[groupName][keypath.str]) {
  			addKeypaths(childDeps);
  		}
  	}

  	function dispatch(set) {
  		var value = viewmodel.get(set.keypath);
  		set.deps.forEach(function (d) {
  			return d.setValue(value);
  		});
  	}
  }

  function findDependants(viewmodel, keypath, groupName) {
  	var group = viewmodel.deps[groupName];
  	return group ? group[keypath.str] : null;
  }

  var capture = Viewmodel$capture;

  function Viewmodel$capture() {
  	this.captureGroups.push([]);
  }

  var clearCache = Viewmodel$clearCache;

  function Viewmodel$clearCache(keypath, keepExistingWrapper) {
  	var cacheMap, wrapper;

  	if (!keepExistingWrapper) {
  		// Is there a wrapped property at this keypath?
  		if (wrapper = this.wrapped[keypath]) {
  			// Did we unwrap it?
  			if (wrapper.teardown() !== false) {
  				// Is this right?
  				// What's the meaning of returning false from teardown?
  				// Could there be a GC ramification if this is a "real" ractive.teardown()?
  				this.wrapped[keypath] = null;
  			}
  		}
  	}

  	this.cache[keypath] = undefined;

  	if (cacheMap = this.cacheMap[keypath]) {
  		while (cacheMap.length) {
  			this.clearCache(cacheMap.pop());
  		}
  	}
  }

  var UnresolvedDependency = function (computation, ref) {
  	this.computation = computation;
  	this.viewmodel = computation.viewmodel;
  	this.ref = ref;

  	// TODO this seems like a red flag!
  	this.root = this.viewmodel.ractive;
  	this.parentFragment = this.root.component && this.root.component.parentFragment;
  };

  UnresolvedDependency.prototype = {
  	resolve: function (keypath) {
  		this.computation.softDeps.push(keypath);
  		this.computation.unresolvedDeps[keypath.str] = null;
  		this.viewmodel.register(keypath, this.computation, "computed");
  	}
  };

  var Computation_UnresolvedDependency = UnresolvedDependency;

  var Computation = function (key, signature) {
  	this.key = key;

  	this.getter = signature.getter;
  	this.setter = signature.setter;

  	this.hardDeps = signature.deps || [];
  	this.softDeps = [];
  	this.unresolvedDeps = {};

  	this.depValues = {};

  	this._dirty = this._firstRun = true;
  };

  Computation.prototype = {
  	constructor: Computation,

  	init: function (viewmodel) {
  		var _this = this;

  		var initial;

  		this.viewmodel = viewmodel;
  		this.bypass = true;

  		initial = viewmodel.get(this.key);
  		viewmodel.clearCache(this.key.str);

  		this.bypass = false;

  		if (this.setter && initial !== undefined) {
  			this.set(initial);
  		}

  		if (this.hardDeps) {
  			this.hardDeps.forEach(function (d) {
  				return viewmodel.register(d, _this, "computed");
  			});
  		}
  	},

  	invalidate: function () {
  		this._dirty = true;
  	},

  	get: function () {
  		var _this = this;

  		var newDeps,
  		    dependenciesChanged,
  		    dependencyValuesChanged = false;

  		if (this.getting) {
  			// prevent double-computation (e.g. caused by array mutation inside computation)
  			var msg = "The " + this.key.str + " computation indirectly called itself. This probably indicates a bug in the computation. It is commonly caused by `array.sort(...)` - if that's the case, clone the array first with `array.slice().sort(...)`";
  			warnOnce(msg);
  			return this.value;
  		}

  		this.getting = true;

  		if (this._dirty) {
  			// determine whether the inputs have changed, in case this depends on
  			// other computed values
  			if (this._firstRun || !this.hardDeps.length && !this.softDeps.length) {
  				dependencyValuesChanged = true;
  			} else {
  				[this.hardDeps, this.softDeps].forEach(function (deps) {
  					var keypath, value, i;

  					if (dependencyValuesChanged) {
  						return;
  					}

  					i = deps.length;
  					while (i--) {
  						keypath = deps[i];
  						value = _this.viewmodel.get(keypath);

  						if (!isEqual(value, _this.depValues[keypath.str])) {
  							_this.depValues[keypath.str] = value;
  							dependencyValuesChanged = true;

  							return;
  						}
  					}
  				});
  			}

  			if (dependencyValuesChanged) {
  				this.viewmodel.capture();

  				try {
  					this.value = this.getter();
  				} catch (err) {
  					warnIfDebug("Failed to compute \"%s\"", this.key.str);
  					logIfDebug(err.stack || err);

  					this.value = void 0;
  				}

  				newDeps = this.viewmodel.release();
  				dependenciesChanged = this.updateDependencies(newDeps);

  				if (dependenciesChanged) {
  					[this.hardDeps, this.softDeps].forEach(function (deps) {
  						deps.forEach(function (keypath) {
  							_this.depValues[keypath.str] = _this.viewmodel.get(keypath);
  						});
  					});
  				}
  			}

  			this._dirty = false;
  		}

  		this.getting = this._firstRun = false;
  		return this.value;
  	},

  	set: function (value) {
  		if (this.setting) {
  			this.value = value;
  			return;
  		}

  		if (!this.setter) {
  			throw new Error("Computed properties without setters are read-only. (This may change in a future version of Ractive!)");
  		}

  		this.setter(value);
  	},

  	updateDependencies: function (newDeps) {
  		var i, oldDeps, keypath, dependenciesChanged, unresolved;

  		oldDeps = this.softDeps;

  		// remove dependencies that are no longer used
  		i = oldDeps.length;
  		while (i--) {
  			keypath = oldDeps[i];

  			if (newDeps.indexOf(keypath) === -1) {
  				dependenciesChanged = true;
  				this.viewmodel.unregister(keypath, this, "computed");
  			}
  		}

  		// create references for any new dependencies
  		i = newDeps.length;
  		while (i--) {
  			keypath = newDeps[i];

  			if (oldDeps.indexOf(keypath) === -1 && (!this.hardDeps || this.hardDeps.indexOf(keypath) === -1)) {
  				dependenciesChanged = true;

  				// if this keypath is currently unresolved, we need to mark
  				// it as such. TODO this is a bit muddy...
  				if (isUnresolved(this.viewmodel, keypath) && !this.unresolvedDeps[keypath.str]) {
  					unresolved = new Computation_UnresolvedDependency(this, keypath.str);
  					newDeps.splice(i, 1);

  					this.unresolvedDeps[keypath.str] = unresolved;
  					global_runloop.addUnresolved(unresolved);
  				} else {
  					this.viewmodel.register(keypath, this, "computed");
  				}
  			}
  		}

  		if (dependenciesChanged) {
  			this.softDeps = newDeps.slice();
  		}

  		return dependenciesChanged;
  	}
  };

  function isUnresolved(viewmodel, keypath) {
  	var key = keypath.firstKey;

  	return !(key in viewmodel.data) && !(key in viewmodel.computations) && !(key in viewmodel.mappings);
  }

  var Computation_Computation = Computation;

  var compute = Viewmodel$compute;
  function Viewmodel$compute(key, signature) {
  	var computation = new Computation_Computation(key, signature);

  	if (this.ready) {
  		computation.init(this);
  	}

  	return this.computations[key.str] = computation;
  }

  var FAILED_LOOKUP = { FAILED_LOOKUP: true };

  var viewmodel_prototype_get = Viewmodel$get;

  var viewmodel_prototype_get__empty = {};
  function Viewmodel$get(keypath, options) {
  	var cache = this.cache,
  	    value,
  	    computation,
  	    wrapped,
  	    captureGroup,
  	    keypathStr = keypath.str,
  	    key;

  	options = options || viewmodel_prototype_get__empty;

  	// capture the keypath, if we're inside a computation
  	if (options.capture && (captureGroup = lastItem(this.captureGroups))) {
  		if (! ~captureGroup.indexOf(keypath)) {
  			captureGroup.push(keypath);
  		}
  	}

  	if (hasOwn.call(this.mappings, keypath.firstKey)) {
  		return this.mappings[keypath.firstKey].get(keypath, options);
  	}

  	if (keypath.isSpecial) {
  		return keypath.value;
  	}

  	if (cache[keypathStr] === undefined) {

  		// Is this a computed property?
  		if ((computation = this.computations[keypathStr]) && !computation.bypass) {
  			value = computation.get();
  			this.adapt(keypathStr, value);
  		}

  		// Is this a wrapped property?
  		else if (wrapped = this.wrapped[keypathStr]) {
  			value = wrapped.value;
  		}

  		// Is it the root?
  		else if (keypath.isRoot) {
  			this.adapt("", this.data);
  			value = this.data;
  		}

  		// No? Then we need to retrieve the value one key at a time
  		else {
  			value = retrieve(this, keypath);
  		}

  		cache[keypathStr] = value;
  	} else {
  		value = cache[keypathStr];
  	}

  	if (!options.noUnwrap && (wrapped = this.wrapped[keypathStr])) {
  		value = wrapped.get();
  	}

  	if (keypath.isRoot && options.fullRootGet) {
  		for (key in this.mappings) {
  			value[key] = this.mappings[key].getValue();
  		}
  	}

  	return value === FAILED_LOOKUP ? void 0 : value;
  }

  function retrieve(viewmodel, keypath) {

  	var parentValue, cacheMap, value, wrapped;

  	parentValue = viewmodel.get(keypath.parent);

  	if (wrapped = viewmodel.wrapped[keypath.parent.str]) {
  		parentValue = wrapped.get();
  	}

  	if (parentValue === null || parentValue === undefined) {
  		return;
  	}

  	// update cache map
  	if (!(cacheMap = viewmodel.cacheMap[keypath.parent.str])) {
  		viewmodel.cacheMap[keypath.parent.str] = [keypath.str];
  	} else {
  		if (cacheMap.indexOf(keypath.str) === -1) {
  			cacheMap.push(keypath.str);
  		}
  	}

  	// If this property doesn't exist, we return a sentinel value
  	// so that we know to query parent scope (if such there be)
  	if (typeof parentValue === "object" && !(keypath.lastKey in parentValue)) {
  		return viewmodel.cache[keypath.str] = FAILED_LOOKUP;
  	}

  	value = parentValue[keypath.lastKey];

  	// Do we have an adaptor for this value?
  	viewmodel.adapt(keypath.str, value, false);

  	// Update cache
  	viewmodel.cache[keypath.str] = value;
  	return value;
  }

  var viewmodel_prototype_init = Viewmodel$init;

  function Viewmodel$init() {
  	var key;

  	for (key in this.computations) {
  		this.computations[key].init(this);
  	}
  }

  var prototype_map = Viewmodel$map;

  function Viewmodel$map(key, options) {
  	var mapping = this.mappings[key.str] = new Mapping(key, options);
  	mapping.initViewmodel(this);
  	return mapping;
  }

  var Mapping = function (localKey, options) {
  	this.localKey = localKey;
  	this.keypath = options.keypath;
  	this.origin = options.origin;

  	this.deps = [];
  	this.unresolved = [];

  	this.resolved = false;
  };

  Mapping.prototype = {
  	forceResolution: function () {
  		// TODO warn, as per #1692?
  		this.keypath = this.localKey;
  		this.setup();
  	},

  	get: function (keypath, options) {
  		if (!this.resolved) {
  			return undefined;
  		}
  		return this.origin.get(this.map(keypath), options);
  	},

  	getValue: function () {
  		if (!this.keypath) {
  			return undefined;
  		}
  		return this.origin.get(this.keypath);
  	},

  	initViewmodel: function (viewmodel) {
  		this.local = viewmodel;
  		this.setup();
  	},

  	map: function (keypath) {
  		if (typeof this.keypath === undefined) {
  			return this.localKey;
  		}
  		return keypath.replace(this.localKey, this.keypath);
  	},

  	register: function (keypath, dependant, group) {
  		this.deps.push({ keypath: keypath, dep: dependant, group: group });

  		if (this.resolved) {
  			this.origin.register(this.map(keypath), dependant, group);
  		}
  	},

  	resolve: function (keypath) {
  		if (this.keypath !== undefined) {
  			this.unbind(true);
  		}

  		this.keypath = keypath;
  		this.setup();
  	},

  	set: function (keypath, value) {
  		if (!this.resolved) {
  			this.forceResolution();
  		}

  		this.origin.set(this.map(keypath), value);
  	},

  	setup: function () {
  		var _this = this;

  		if (this.keypath === undefined) {
  			return;
  		}

  		this.resolved = true;

  		// accumulated dependants can now be registered
  		if (this.deps.length) {
  			this.deps.forEach(function (d) {
  				var keypath = _this.map(d.keypath);
  				_this.origin.register(keypath, d.dep, d.group);

  				// TODO this is a bit of a red flag... all deps should be the same?
  				if (d.dep.setValue) {
  					d.dep.setValue(_this.origin.get(keypath));
  				} else if (d.dep.invalidate) {
  					d.dep.invalidate();
  				} else {
  					throw new Error("An unexpected error occurred. Please raise an issue at https://github.com/ractivejs/ractive/issues - thanks!");
  				}
  			});

  			this.origin.mark(this.keypath);
  		}
  	},

  	setValue: function (value) {
  		if (!this.keypath) {
  			throw new Error("Mapping does not have keypath, cannot set value. Please raise an issue at https://github.com/ractivejs/ractive/issues - thanks!");
  		}

  		this.origin.set(this.keypath, value);
  	},

  	unbind: function (keepLocal) {
  		var _this = this;

  		if (!keepLocal) {
  			delete this.local.mappings[this.localKey];
  		}

  		if (!this.resolved) {
  			return;
  		}

  		this.deps.forEach(function (d) {
  			_this.origin.unregister(_this.map(d.keypath), d.dep, d.group);
  		});

  		if (this.tracker) {
  			this.origin.unregister(this.keypath, this.tracker);
  		}
  	},

  	unregister: function (keypath, dependant, group) {
  		var deps, i;

  		if (!this.resolved) {
  			return;
  		}

  		deps = this.deps;
  		i = deps.length;

  		while (i--) {
  			if (deps[i].dep === dependant) {
  				deps.splice(i, 1);
  				break;
  			}
  		}
  		this.origin.unregister(this.map(keypath), dependant, group);
  	}
  };

  var mark = Viewmodel$mark;

  function Viewmodel$mark(keypath, options) {
  	var computation,
  	    keypathStr = keypath.str;

  	// implicit changes (i.e. `foo.length` on `ractive.push('foo',42)`)
  	// should not be picked up by pattern observers
  	if (options) {
  		if (options.implicit) {
  			this.implicitChanges[keypathStr] = true;
  		}
  		if (options.noCascade) {
  			this.noCascade[keypathStr] = true;
  		}
  	}

  	if (computation = this.computations[keypathStr]) {
  		computation.invalidate();
  	}

  	if (this.changes.indexOf(keypath) === -1) {
  		this.changes.push(keypath);
  	}

  	// pass on keepExistingWrapper, if we can
  	var keepExistingWrapper = options ? options.keepExistingWrapper : false;

  	this.clearCache(keypathStr, keepExistingWrapper);

  	if (this.ready) {
  		this.onchange();
  	}
  }

  var mapOldToNewIndex = function (oldArray, newArray) {
  	var usedIndices, firstUnusedIndex, newIndices, changed;

  	usedIndices = {};
  	firstUnusedIndex = 0;

  	newIndices = oldArray.map(function (item, i) {
  		var index, start, len;

  		start = firstUnusedIndex;
  		len = newArray.length;

  		do {
  			index = newArray.indexOf(item, start);

  			if (index === -1) {
  				changed = true;
  				return -1;
  			}

  			start = index + 1;
  		} while (usedIndices[index] && start < len);

  		// keep track of the first unused index, so we don't search
  		// the whole of newArray for each item in oldArray unnecessarily
  		if (index === firstUnusedIndex) {
  			firstUnusedIndex += 1;
  		}

  		if (index !== i) {
  			changed = true;
  		}

  		usedIndices[index] = true;
  		return index;
  	});

  	return newIndices;
  };

  var merge = Viewmodel$merge;

  var comparators = {};
  function Viewmodel$merge(keypath, currentArray, array, options) {
  	var oldArray, newArray, comparator, newIndices;

  	this.mark(keypath);

  	if (options && options.compare) {

  		comparator = getComparatorFunction(options.compare);

  		try {
  			oldArray = currentArray.map(comparator);
  			newArray = array.map(comparator);
  		} catch (err) {
  			// fallback to an identity check - worst case scenario we have
  			// to do more DOM manipulation than we thought...
  			warnIfDebug("merge(): \"%s\" comparison failed. Falling back to identity checking", keypath);

  			oldArray = currentArray;
  			newArray = array;
  		}
  	} else {
  		oldArray = currentArray;
  		newArray = array;
  	}

  	// find new indices for members of oldArray
  	newIndices = mapOldToNewIndex(oldArray, newArray);

  	this.smartUpdate(keypath, array, newIndices, currentArray.length !== array.length);
  }

  function stringify(item) {
  	return JSON.stringify(item);
  }

  function getComparatorFunction(comparator) {
  	// If `compare` is `true`, we use JSON.stringify to compare
  	// objects that are the same shape, but non-identical - i.e.
  	// { foo: 'bar' } !== { foo: 'bar' }
  	if (comparator === true) {
  		return stringify;
  	}

  	if (typeof comparator === "string") {
  		if (!comparators[comparator]) {
  			comparators[comparator] = function (item) {
  				return item[comparator];
  			};
  		}

  		return comparators[comparator];
  	}

  	if (typeof comparator === "function") {
  		return comparator;
  	}

  	throw new Error("The `compare` option must be a function, or a string representing an identifying field (or `true` to use JSON.stringify)");
  }

  var register = Viewmodel$register;

  function Viewmodel$register(keypath, dependant) {
  	var group = arguments[2] === undefined ? "default" : arguments[2];

  	var mapping, depsByKeypath, deps;

  	if (dependant.isStatic) {
  		return; // TODO we should never get here if a dependant is static...
  	}

  	if (mapping = this.mappings[keypath.firstKey]) {
  		mapping.register(keypath, dependant, group);
  	} else {
  		depsByKeypath = this.deps[group] || (this.deps[group] = {});
  		deps = depsByKeypath[keypath.str] || (depsByKeypath[keypath.str] = []);

  		deps.push(dependant);

  		if (!this.depsMap[group]) {
  			this.depsMap[group] = {};
  		}

  		if (!keypath.isRoot) {
  			register__updateDependantsMap(this, keypath, group);
  		}
  	}
  }

  function register__updateDependantsMap(viewmodel, keypath, group) {
  	var map, parent, keypathStr;

  	// update dependants map
  	while (!keypath.isRoot) {
  		map = viewmodel.depsMap[group];
  		parent = map[keypath.parent.str] || (map[keypath.parent.str] = []);

  		keypathStr = keypath.str;

  		// TODO find an alternative to this nasty approach
  		if (parent["_" + keypathStr] === undefined) {
  			parent["_" + keypathStr] = 0;
  			parent.push(keypath);
  		}

  		parent["_" + keypathStr] += 1;
  		keypath = keypath.parent;
  	}
  }

  var release = Viewmodel$release;

  function Viewmodel$release() {
  	return this.captureGroups.pop();
  }

  var reset = Viewmodel$reset;

  function Viewmodel$reset(data) {
  	this.data = data;
  	this.clearCache("");
  }

  var prototype_set = Viewmodel$set;

  function Viewmodel$set(keypath, value) {
  	var options = arguments[2] === undefined ? {} : arguments[2];

  	var mapping, computation, wrapper, keepExistingWrapper;

  	// unless data is being set for data tracking purposes
  	if (!options.noMapping) {
  		// If this data belongs to a different viewmodel,
  		// pass the change along
  		if (mapping = this.mappings[keypath.firstKey]) {
  			return mapping.set(keypath, value);
  		}
  	}

  	computation = this.computations[keypath.str];
  	if (computation) {
  		if (computation.setting) {
  			// let the other computation set() handle things...
  			return;
  		}
  		computation.set(value);
  		value = computation.get();
  	}

  	if (isEqual(this.cache[keypath.str], value)) {
  		return;
  	}

  	wrapper = this.wrapped[keypath.str];

  	// If we have a wrapper with a `reset()` method, we try and use it. If the
  	// `reset()` method returns false, the wrapper should be torn down, and
  	// (most likely) a new one should be created later
  	if (wrapper && wrapper.reset) {
  		keepExistingWrapper = wrapper.reset(value) !== false;

  		if (keepExistingWrapper) {
  			value = wrapper.get();
  		}
  	}

  	if (!computation && !keepExistingWrapper) {
  		resolveSet(this, keypath, value);
  	}

  	if (!options.silent) {
  		this.mark(keypath);
  	} else {
  		// We're setting a parent of the original target keypath (i.e.
  		// creating a fresh branch) - we need to clear the cache, but
  		// not mark it as a change
  		this.clearCache(keypath.str);
  	}
  }

  function resolveSet(viewmodel, keypath, value) {
  	var wrapper, parentValue, wrapperSet, valueSet;

  	wrapperSet = function () {
  		if (wrapper.set) {
  			wrapper.set(keypath.lastKey, value);
  		} else {
  			parentValue = wrapper.get();
  			valueSet();
  		}
  	};

  	valueSet = function () {
  		if (!parentValue) {
  			parentValue = createBranch(keypath.lastKey);
  			viewmodel.set(keypath.parent, parentValue, { silent: true });
  		}
  		parentValue[keypath.lastKey] = value;
  	};

  	wrapper = viewmodel.wrapped[keypath.parent.str];

  	if (wrapper) {
  		wrapperSet();
  	} else {
  		parentValue = viewmodel.get(keypath.parent);

  		// may have been wrapped via the above .get()
  		// call on viewmodel if this is first access via .set()!
  		if (wrapper = viewmodel.wrapped[keypath.parent.str]) {
  			wrapperSet();
  		} else {
  			valueSet();
  		}
  	}
  }

  var smartUpdate = Viewmodel$smartUpdate;

  var implicitOption = { implicit: true },
      noCascadeOption = { noCascade: true };
  function Viewmodel$smartUpdate(keypath, array, newIndices) {
  	var _this = this;

  	var dependants, oldLength, i;

  	oldLength = newIndices.length;

  	// Indices that are being removed should be marked as dirty
  	newIndices.forEach(function (newIndex, oldIndex) {
  		if (newIndex === -1) {
  			_this.mark(keypath.join(oldIndex), noCascadeOption);
  		}
  	});

  	// Update the model
  	// TODO allow existing array to be updated in place, rather than replaced?
  	this.set(keypath, array, { silent: true });

  	if (dependants = this.deps["default"][keypath.str]) {
  		dependants.filter(canShuffle).forEach(function (d) {
  			return d.shuffle(newIndices, array);
  		});
  	}

  	if (oldLength !== array.length) {
  		this.mark(keypath.join("length"), implicitOption);

  		for (i = newIndices.touchedFrom; i < array.length; i += 1) {
  			this.mark(keypath.join(i));
  		}

  		// don't allow removed indexes beyond end of new array to trigger recomputations
  		// TODO is this still necessary, now that computations are lazy?
  		for (i = array.length; i < oldLength; i += 1) {
  			this.mark(keypath.join(i), noCascadeOption);
  		}
  	}
  }

  function canShuffle(dependant) {
  	return typeof dependant.shuffle === "function";
  }

  var prototype_teardown = Viewmodel$teardown;

  function Viewmodel$teardown() {
  	var _this = this;

  	var unresolvedImplicitDependency;

  	// Clear entire cache - this has the desired side-effect
  	// of unwrapping adapted values (e.g. arrays)
  	Object.keys(this.cache).forEach(function (keypath) {
  		return _this.clearCache(keypath);
  	});

  	// Teardown any failed lookups - we don't need them to resolve any more
  	while (unresolvedImplicitDependency = this.unresolvedImplicitDependencies.pop()) {
  		unresolvedImplicitDependency.teardown();
  	}
  }

  var unregister = Viewmodel$unregister;

  function Viewmodel$unregister(keypath, dependant) {
  	var group = arguments[2] === undefined ? "default" : arguments[2];

  	var mapping, deps, index;

  	if (dependant.isStatic) {
  		return;
  	}

  	if (mapping = this.mappings[keypath.firstKey]) {
  		return mapping.unregister(keypath, dependant, group);
  	}

  	deps = this.deps[group][keypath.str];
  	index = deps.indexOf(dependant);

  	if (index === -1) {
  		throw new Error("Attempted to remove a dependant that was no longer registered! This should not happen. If you are seeing this bug in development please raise an issue at https://github.com/RactiveJS/Ractive/issues - thanks");
  	}

  	deps.splice(index, 1);

  	if (keypath.isRoot) {
  		return;
  	}

  	unregister__updateDependantsMap(this, keypath, group);
  }

  function unregister__updateDependantsMap(viewmodel, keypath, group) {
  	var map, parent;

  	// update dependants map
  	while (!keypath.isRoot) {
  		map = viewmodel.depsMap[group];
  		parent = map[keypath.parent.str];

  		parent["_" + keypath.str] -= 1;

  		if (!parent["_" + keypath.str]) {
  			// remove from parent deps map
  			removeFromArray(parent, keypath);
  			parent["_" + keypath.str] = undefined;
  		}

  		keypath = keypath.parent;
  	}
  }

  var Viewmodel = function (options) {
  	var adapt = options.adapt;
  	var data = options.data;
  	var ractive = options.ractive;
  	var computed = options.computed;
  	var mappings = options.mappings;
  	var key;
  	var mapping;

  	// TODO is it possible to remove this reference?
  	this.ractive = ractive;

  	this.adaptors = adapt;
  	this.onchange = options.onchange;

  	this.cache = {}; // we need to be able to use hasOwnProperty, so can't inherit from null
  	this.cacheMap = create(null);

  	this.deps = {
  		computed: create(null),
  		"default": create(null)
  	};
  	this.depsMap = {
  		computed: create(null),
  		"default": create(null)
  	};

  	this.patternObservers = [];

  	this.specials = create(null);

  	this.wrapped = create(null);
  	this.computations = create(null);

  	this.captureGroups = [];
  	this.unresolvedImplicitDependencies = [];

  	this.changes = [];
  	this.implicitChanges = {};
  	this.noCascade = {};

  	this.data = data;

  	// set up explicit mappings
  	this.mappings = create(null);
  	for (key in mappings) {
  		this.map(getKeypath(key), mappings[key]);
  	}

  	if (data) {
  		// if data exists locally, but is missing on the parent,
  		// we transfer ownership to the parent
  		for (key in data) {
  			if ((mapping = this.mappings[key]) && mapping.getValue() === undefined) {
  				mapping.setValue(data[key]);
  			}
  		}
  	}

  	for (key in computed) {
  		if (mappings && key in mappings) {
  			fatal("Cannot map to a computed property ('%s')", key);
  		}

  		this.compute(getKeypath(key), computed[key]);
  	}

  	this.ready = true;
  };

  Viewmodel.prototype = {
  	adapt: prototype_adapt,
  	applyChanges: applyChanges,
  	capture: capture,
  	clearCache: clearCache,
  	compute: compute,
  	get: viewmodel_prototype_get,
  	init: viewmodel_prototype_init,
  	map: prototype_map,
  	mark: mark,
  	merge: merge,
  	register: register,
  	release: release,
  	reset: reset,
  	set: prototype_set,
  	smartUpdate: smartUpdate,
  	teardown: prototype_teardown,
  	unregister: unregister
  };

  var viewmodel_Viewmodel = Viewmodel;

  function HookQueue(event) {
  	this.hook = new hooks_Hook(event);
  	this.inProcess = {};
  	this.queue = {};
  }

  HookQueue.prototype = {

  	constructor: HookQueue,

  	begin: function (ractive) {
  		this.inProcess[ractive._guid] = true;
  	},

  	end: function (ractive) {

  		var parent = ractive.parent;

  		// If this is *isn't* a child of a component that's in process,
  		// it should call methods or fire at this point
  		if (!parent || !this.inProcess[parent._guid]) {
  			fire(this, ractive);
  		}
  		// elsewise, handoff to parent to fire when ready
  		else {
  			getChildQueue(this.queue, parent).push(ractive);
  		}

  		delete this.inProcess[ractive._guid];
  	}
  };

  function getChildQueue(queue, ractive) {
  	return queue[ractive._guid] || (queue[ractive._guid] = []);
  }

  function fire(hookQueue, ractive) {

  	var childQueue = getChildQueue(hookQueue.queue, ractive);

  	hookQueue.hook.fire(ractive);

  	// queue is "live" because components can end up being
  	// added while hooks fire on parents that modify data values.
  	while (childQueue.length) {
  		fire(hookQueue, childQueue.shift());
  	}

  	delete hookQueue.queue[ractive._guid];
  }

  var hooks_HookQueue = HookQueue;

  var helpers_getComputationSignatures = getComputationSignatures;

  var helpers_getComputationSignatures__pattern = /\$\{([^\}]+)\}/g;
  function getComputationSignatures(ractive, computed) {
  	var signatures = {},
  	    key;

  	for (key in computed) {
  		signatures[key] = getComputationSignature(ractive, key, computed[key]);
  	}

  	return signatures;
  }

  function getComputationSignature(ractive, key, signature) {
  	var getter, setter;

  	if (typeof signature === "function") {
  		getter = helpers_getComputationSignatures__bind(signature, ractive);
  	}

  	if (typeof signature === "string") {
  		getter = createFunctionFromString(ractive, signature);
  	}

  	if (typeof signature === "object") {
  		if (typeof signature.get === "string") {
  			getter = createFunctionFromString(ractive, signature.get);
  		} else if (typeof signature.get === "function") {
  			getter = helpers_getComputationSignatures__bind(signature.get, ractive);
  		} else {
  			fatal("`%s` computation must have a `get()` method", key);
  		}

  		if (typeof signature.set === "function") {
  			setter = helpers_getComputationSignatures__bind(signature.set, ractive);
  		}
  	}

  	return { getter: getter, setter: setter };
  }

  function createFunctionFromString(ractive, str) {
  	var functionBody, hasThis, fn;

  	functionBody = "return (" + str.replace(helpers_getComputationSignatures__pattern, function (match, keypath) {
  		hasThis = true;
  		return "__ractive.get(\"" + keypath + "\")";
  	}) + ");";

  	if (hasThis) {
  		functionBody = "var __ractive = this; " + functionBody;
  	}

  	fn = new Function(functionBody);
  	return hasThis ? fn.bind(ractive) : fn;
  }

  function helpers_getComputationSignatures__bind(fn, context) {
  	return /this/.test(fn.toString()) ? fn.bind(context) : fn;
  }

  var constructHook = new hooks_Hook("construct");
  var configHook = new hooks_Hook("config");
  var initHook = new hooks_HookQueue("init");
  var initialise__uid = 0;

  var initialise__registryNames = ["adaptors", "components", "decorators", "easing", "events", "interpolators", "partials", "transitions"];

  var initialise = initialiseRactiveInstance;

  function initialiseRactiveInstance(ractive) {
  	var userOptions = arguments[1] === undefined ? {} : arguments[1];
  	var options = arguments[2] === undefined ? {} : arguments[2];

  	var el, viewmodel;

  	if (_Ractive.DEBUG) {
  		welcome();
  	}

  	initialiseProperties(ractive, options);

  	// TODO remove this, eventually
  	defineProperty(ractive, "data", { get: deprecateRactiveData });

  	// TODO don't allow `onconstruct` with `new Ractive()`, there's no need for it
  	constructHook.fire(ractive, userOptions);

  	// Add registries
  	initialise__registryNames.forEach(function (name) {
  		ractive[name] = utils_object__extend(create(ractive.constructor[name] || null), userOptions[name]);
  	});

  	// Create a viewmodel
  	viewmodel = new viewmodel_Viewmodel({
  		adapt: getAdaptors(ractive, ractive.adapt, userOptions),
  		data: custom_data.init(ractive.constructor, ractive, userOptions),
  		computed: helpers_getComputationSignatures(ractive, utils_object__extend(create(ractive.constructor.prototype.computed), userOptions.computed)),
  		mappings: options.mappings,
  		ractive: ractive,
  		onchange: function () {
  			return global_runloop.addRactive(ractive);
  		}
  	});

  	ractive.viewmodel = viewmodel;

  	// This can't happen earlier, because computed properties may call `ractive.get()`, etc
  	viewmodel.init();

  	// init config from Parent and options
  	config_config.init(ractive.constructor, ractive, userOptions);

  	configHook.fire(ractive);
  	initHook.begin(ractive);

  	// // If this is a component with a function `data` property, call the function
  	// // with `ractive` as context (unless the child was also a function)
  	// if ( typeof ractive.constructor.prototype.data === 'function' && typeof userOptions.data !== 'function' ) {
  	// 	viewmodel.reset( ractive.constructor.prototype.data.call( ractive ) || fatal( '`data` functions must return a data object' ) );
  	// }

  	// Render virtual DOM
  	if (ractive.template) {
  		var cssIds = undefined;

  		if (options.cssIds || ractive.cssId) {
  			cssIds = options.cssIds ? options.cssIds.slice() : [];

  			if (ractive.cssId) {
  				cssIds.push(ractive.cssId);
  			}
  		}

  		ractive.fragment = new virtualdom_Fragment({
  			template: ractive.template,
  			root: ractive,
  			owner: ractive, // saves doing `if ( this.parent ) { /*...*/ }` later on
  			cssIds: cssIds
  		});
  	}

  	initHook.end(ractive);

  	// render automatically ( if `el` is specified )
  	if (el = getElement(ractive.el)) {
  		var promise = ractive.render(el, ractive.append);

  		if (_Ractive.DEBUG_PROMISES) {
  			promise["catch"](function (err) {
  				warnOnceIfDebug("Promise debugging is enabled, to help solve errors that happen asynchronously. Some browsers will log unhandled promise rejections, in which case you can safely disable promise debugging:\n  Ractive.DEBUG_PROMISES = false;");
  				warnIfDebug("An error happened during rendering", { ractive: ractive });
  				err.stack && logIfDebug(err.stack);

  				throw err;
  			});
  		}
  	}
  }

  function getAdaptors(ractive, protoAdapt, userOptions) {
  	var adapt, magic, modifyArrays;

  	protoAdapt = protoAdapt.map(lookup);
  	adapt = ensureArray(userOptions.adapt).map(lookup);

  	adapt = initialise__combine(protoAdapt, adapt);

  	magic = "magic" in userOptions ? userOptions.magic : ractive.magic;
  	modifyArrays = "modifyArrays" in userOptions ? userOptions.modifyArrays : ractive.modifyArrays;

  	if (magic) {
  		if (!environment__magic) {
  			throw new Error("Getters and setters (magic mode) are not supported in this browser");
  		}

  		if (modifyArrays) {
  			adapt.push(magicArray);
  		}

  		adapt.push(adaptors_magic);
  	}

  	if (modifyArrays) {
  		adapt.push(array_index);
  	}

  	return adapt;

  	function lookup(adaptor) {
  		if (typeof adaptor === "string") {
  			adaptor = findInViewHierarchy("adaptors", ractive, adaptor);

  			if (!adaptor) {
  				fatal(missingPlugin(adaptor, "adaptor"));
  			}
  		}

  		return adaptor;
  	}
  }

  function initialise__combine(a, b) {
  	var c = a.slice(),
  	    i = b.length;

  	while (i--) {
  		if (! ~c.indexOf(b[i])) {
  			c.push(b[i]);
  		}
  	}

  	return c;
  }

  function initialiseProperties(ractive, options) {
  	// Generate a unique identifier, for places where you'd use a weak map if it
  	// existed
  	ractive._guid = "r-" + initialise__uid++;

  	// events
  	ractive._subs = create(null);

  	// storage for item configuration from instantiation to reset,
  	// like dynamic functions or original values
  	ractive._config = {};

  	// two-way bindings
  	ractive._twowayBindings = create(null);

  	// animations (so we can stop any in progress at teardown)
  	ractive._animations = [];

  	// nodes registry
  	ractive.nodes = {};

  	// live queries
  	ractive._liveQueries = [];
  	ractive._liveComponentQueries = [];

  	// bound data functions
  	ractive._boundFunctions = [];

  	// observers
  	ractive._observers = [];

  	// properties specific to inline components
  	if (options.component) {
  		ractive.parent = options.parent;
  		ractive.container = options.container || null;
  		ractive.root = ractive.parent.root;

  		ractive.component = options.component;
  		options.component.instance = ractive;

  		// for hackability, this could be an open option
  		// for any ractive instance, but for now, just
  		// for components and just for ractive...
  		ractive._inlinePartials = options.inlinePartials;
  	} else {
  		ractive.root = ractive;
  		ractive.parent = ractive.container = null;
  	}
  }

  function deprecateRactiveData() {
  	throw new Error("Using `ractive.data` is no longer supported - you must use the `ractive.get()` API instead");
  }

  function ComplexParameter(component, template, callback) {
  	this.parentFragment = component.parentFragment;
  	this.callback = callback;

  	this.fragment = new virtualdom_Fragment({
  		template: template,
  		root: component.root,
  		owner: this
  	});

  	this.update();
  }

  var initialise_ComplexParameter = ComplexParameter;

  ComplexParameter.prototype = {
  	bubble: function () {
  		if (!this.dirty) {
  			this.dirty = true;
  			global_runloop.addView(this);
  		}
  	},

  	update: function () {
  		this.callback(this.fragment.getValue());
  		this.dirty = false;
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		this.fragment.rebind(oldKeypath, newKeypath);
  	},

  	unbind: function () {
  		this.fragment.unbind();
  	}
  };

  var createInstance = function (component, Component, attributes, yieldTemplate, partials) {
  	var instance,
  	    parentFragment,
  	    ractive,
  	    fragment,
  	    container,
  	    inlinePartials = {},
  	    data = {},
  	    mappings = {},
  	    ready,
  	    resolvers = [];

  	parentFragment = component.parentFragment;
  	ractive = component.root;

  	partials = partials || {};
  	utils_object__extend(inlinePartials, partials);

  	// Make contents available as a {{>content}} partial
  	partials.content = yieldTemplate || [];

  	// set a default partial for yields with no name
  	inlinePartials[""] = partials.content;

  	if (Component.defaults.el) {
  		warnIfDebug("The <%s/> component has a default `el` property; it has been disregarded", component.name);
  	}

  	// find container
  	fragment = parentFragment;
  	while (fragment) {
  		if (fragment.owner.type === YIELDER) {
  			container = fragment.owner.container;
  			break;
  		}

  		fragment = fragment.parent;
  	}

  	// each attribute represents either a) data or b) a mapping
  	if (attributes) {
  		Object.keys(attributes).forEach(function (key) {
  			var attribute = attributes[key],
  			    parsed,
  			    resolver;

  			if (typeof attribute === "string") {
  				// it's static data
  				parsed = parseJSON(attribute);
  				data[key] = parsed ? parsed.value : attribute;
  			} else if (attribute === 0) {
  				// it had no '=', so we'll call it true
  				data[key] = true;
  			} else if (isArray(attribute)) {
  				// this represents dynamic data
  				if (isSingleInterpolator(attribute)) {
  					mappings[key] = {
  						origin: component.root.viewmodel,
  						keypath: undefined
  					};

  					resolver = createResolver(component, attribute[0], function (keypath) {
  						if (keypath.isSpecial) {
  							if (ready) {
  								instance.set(key, keypath.value); // TODO use viewmodel?
  							} else {
  								data[key] = keypath.value;

  								// TODO errr.... would be better if we didn't have to do this
  								delete mappings[key];
  							}
  						} else {
  							if (ready) {
  								instance.viewmodel.mappings[key].resolve(keypath);
  							} else {
  								// resolved immediately
  								mappings[key].keypath = keypath;
  							}
  						}
  					});
  				} else {
  					resolver = new initialise_ComplexParameter(component, attribute, function (value) {
  						if (ready) {
  							instance.set(key, value); // TODO use viewmodel?
  						} else {
  							data[key] = value;
  						}
  					});
  				}

  				resolvers.push(resolver);
  			} else {
  				throw new Error("erm wut");
  			}
  		});
  	}

  	instance = create(Component.prototype);

  	initialise(instance, {
  		el: null,
  		append: true,
  		data: data,
  		partials: partials,
  		magic: ractive.magic || Component.defaults.magic,
  		modifyArrays: ractive.modifyArrays,
  		// need to inherit runtime parent adaptors
  		adapt: ractive.adapt
  	}, {
  		parent: ractive,
  		component: component,
  		container: container,
  		mappings: mappings,
  		inlinePartials: inlinePartials,
  		cssIds: parentFragment.cssIds
  	});

  	ready = true;
  	component.resolvers = resolvers;

  	return instance;
  };

  function createResolver(component, template, callback) {
  	var resolver;

  	if (template.r) {
  		resolver = Resolvers_createReferenceResolver(component, template.r, callback);
  	} else if (template.x) {
  		resolver = new Resolvers_ExpressionResolver(component, component.parentFragment, template.x, callback);
  	} else if (template.rx) {
  		resolver = new ReferenceExpressionResolver_ReferenceExpressionResolver(component, template.rx, callback);
  	}

  	return resolver;
  }

  function isSingleInterpolator(template) {
  	return template.length === 1 && template[0].t === INTERPOLATOR;
  }

  // TODO how should event arguments be handled? e.g.
  // <widget on-foo='bar:1,2,3'/>
  // The event 'bar' will be fired on the parent instance
  // when 'foo' fires on the child, but the 1,2,3 arguments
  // will be lost

  var initialise_propagateEvents = propagateEvents;

  function propagateEvents(component, eventsDescriptor) {
  	var eventName;

  	for (eventName in eventsDescriptor) {
  		if (eventsDescriptor.hasOwnProperty(eventName)) {
  			propagateEvent(component.instance, component.root, eventName, eventsDescriptor[eventName]);
  		}
  	}
  }

  function propagateEvent(childInstance, parentInstance, eventName, proxyEventName) {
  	if (typeof proxyEventName !== "string") {
  		fatal("Components currently only support simple events - you cannot include arguments. Sorry!");
  	}

  	childInstance.on(eventName, function () {
  		var event, args;

  		// semi-weak test, but what else? tag the event obj ._isEvent ?
  		if (arguments.length && arguments[0] && arguments[0].node) {
  			event = Array.prototype.shift.call(arguments);
  		}

  		args = Array.prototype.slice.call(arguments);

  		shared_fireEvent(parentInstance, proxyEventName, { event: event, args: args });

  		// cancel bubbling
  		return false;
  	});
  }

  var initialise_updateLiveQueries = function (component) {
  	var ancestor, query;

  	// If there's a live query for this component type, add it
  	ancestor = component.root;
  	while (ancestor) {
  		if (query = ancestor._liveComponentQueries["_" + component.name]) {
  			query.push(component.instance);
  		}

  		ancestor = ancestor.parent;
  	}
  };

  var Component_prototype_init = Component$init;
  function Component$init(options, Component) {
  	var parentFragment, root;

  	if (!Component) {
  		throw new Error("Component \"" + this.name + "\" not found");
  	}

  	parentFragment = this.parentFragment = options.parentFragment;
  	root = parentFragment.root;

  	this.root = root;
  	this.type = COMPONENT;
  	this.name = options.template.e;
  	this.index = options.index;
  	this.indexRefBindings = {};
  	this.yielders = {};
  	this.resolvers = [];

  	createInstance(this, Component, options.template.a, options.template.f, options.template.p);
  	initialise_propagateEvents(this, options.template.v);

  	// intro, outro and decorator directives have no effect
  	if (options.template.t0 || options.template.t1 || options.template.t2 || options.template.o) {
  		warnIfDebug("The \"intro\", \"outro\" and \"decorator\" directives have no effect on components", { ractive: this.instance });
  	}

  	initialise_updateLiveQueries(this);
  }

  var Component_prototype_rebind = Component$rebind;

  function Component$rebind(oldKeypath, newKeypath) {
  	var query;

  	this.resolvers.forEach(rebind);

  	for (var k in this.yielders) {
  		if (this.yielders[k][0]) {
  			rebind(this.yielders[k][0]);
  		}
  	}

  	if (query = this.root._liveComponentQueries["_" + this.name]) {
  		query._makeDirty();
  	}

  	function rebind(x) {
  		x.rebind(oldKeypath, newKeypath);
  	}
  }

  var Component_prototype_render = Component$render;

  function Component$render() {
  	var instance = this.instance;

  	instance.render(this.parentFragment.getNode());

  	this.rendered = true;
  	return instance.fragment.detach();
  }

  var Component_prototype_toString = Component$toString;

  function Component$toString() {
  	return this.instance.fragment.toString();
  }

  var Component_prototype_unbind = Component$unbind;

  var Component_prototype_unbind__teardownHook = new hooks_Hook("teardown");
  function Component$unbind() {
  	var instance = this.instance;

  	this.resolvers.forEach(methodCallers__unbind);

  	removeFromLiveComponentQueries(this);

  	instance._observers.forEach(cancel);

  	// teardown the instance
  	instance.fragment.unbind();
  	instance.viewmodel.teardown();

  	if (instance.fragment.rendered && instance.el.__ractive_instances__) {
  		removeFromArray(instance.el.__ractive_instances__, instance);
  	}

  	Component_prototype_unbind__teardownHook.fire(instance);
  }

  function removeFromLiveComponentQueries(component) {
  	var instance, query;

  	instance = component.root;

  	do {
  		if (query = instance._liveComponentQueries["_" + component.name]) {
  			query._remove(component);
  		}
  	} while (instance = instance.parent);
  }

  var Component_prototype_unrender = Component$unrender;

  function Component$unrender(shouldDestroy) {
  	this.shouldDestroy = shouldDestroy;
  	this.instance.unrender();
  }

  var Component = function (options, Constructor) {
  	this.init(options, Constructor);
  };

  Component.prototype = {
  	detach: Component_prototype_detach,
  	find: Component_prototype_find,
  	findAll: Component_prototype_findAll,
  	findAllComponents: Component_prototype_findAllComponents,
  	findComponent: Component_prototype_findComponent,
  	findNextNode: Component_prototype_findNextNode,
  	firstNode: Component_prototype_firstNode,
  	init: Component_prototype_init,
  	rebind: Component_prototype_rebind,
  	render: Component_prototype_render,
  	toString: Component_prototype_toString,
  	unbind: Component_prototype_unbind,
  	unrender: Component_prototype_unrender
  };

  var _Component = Component;

  var Comment = function (options) {
  	this.type = COMMENT;
  	this.value = options.template.c;
  };

  Comment.prototype = {
  	detach: shared_detach,

  	firstNode: function () {
  		return this.node;
  	},

  	render: function () {
  		if (!this.node) {
  			this.node = document.createComment(this.value);
  		}

  		return this.node;
  	},

  	toString: function () {
  		return "<!--" + this.value + "-->";
  	},

  	unrender: function (shouldDestroy) {
  		if (shouldDestroy) {
  			this.node.parentNode.removeChild(this.node);
  		}
  	}
  };

  var items_Comment = Comment;

  var Yielder = function (options) {
  	var container, component;

  	this.type = YIELDER;

  	this.container = container = options.parentFragment.root;
  	this.component = component = container.component;

  	this.container = container;
  	this.containerFragment = options.parentFragment;
  	this.parentFragment = component.parentFragment;

  	var name = this.name = options.template.n || "";

  	var template = container._inlinePartials[name];

  	if (!template) {
  		warnIfDebug("Could not find template for partial \"" + name + "\"", { ractive: options.root });
  		template = [];
  	}

  	this.fragment = new virtualdom_Fragment({
  		owner: this,
  		root: container.parent,
  		template: template,
  		pElement: this.containerFragment.pElement
  	});

  	// even though only one yielder is allowed, we need to have an array of them
  	// as it's possible to cause a yielder to be created before the last one
  	// was destroyed in the same turn of the runloop
  	if (!isArray(component.yielders[name])) {
  		component.yielders[name] = [this];
  	} else {
  		component.yielders[name].push(this);
  	}

  	global_runloop.scheduleTask(function () {
  		if (component.yielders[name].length > 1) {
  			throw new Error("A component template can only have one {{yield" + (name ? " " + name : "") + "}} declaration at a time");
  		}
  	});
  };

  Yielder.prototype = {
  	detach: function () {
  		return this.fragment.detach();
  	},

  	find: function (selector) {
  		return this.fragment.find(selector);
  	},

  	findAll: function (selector, query) {
  		return this.fragment.findAll(selector, query);
  	},

  	findComponent: function (selector) {
  		return this.fragment.findComponent(selector);
  	},

  	findAllComponents: function (selector, query) {
  		return this.fragment.findAllComponents(selector, query);
  	},

  	findNextNode: function () {
  		return this.containerFragment.findNextNode(this);
  	},

  	firstNode: function () {
  		return this.fragment.firstNode();
  	},

  	getValue: function (options) {
  		return this.fragment.getValue(options);
  	},

  	render: function () {
  		return this.fragment.render();
  	},

  	unbind: function () {
  		this.fragment.unbind();
  	},

  	unrender: function (shouldDestroy) {
  		this.fragment.unrender(shouldDestroy);
  		removeFromArray(this.component.yielders[this.name], this);
  	},

  	rebind: function (oldKeypath, newKeypath) {
  		this.fragment.rebind(oldKeypath, newKeypath);
  	},

  	toString: function () {
  		return this.fragment.toString();
  	}
  };

  var items_Yielder = Yielder;

  var Doctype = function (options) {
  	this.declaration = options.template.a;
  };

  Doctype.prototype = {
  	init: noop,
  	render: noop,
  	unrender: noop,
  	teardown: noop,
  	toString: function () {
  		return "<!DOCTYPE" + this.declaration + ">";
  	}
  };

  var items_Doctype = Doctype;

  var Fragment_prototype_init = Fragment$init;

  function Fragment$init(options) {
  	var _this = this;

  	this.owner = options.owner; // The item that owns this fragment - an element, section, partial, or attribute
  	this.parent = this.owner.parentFragment;

  	// inherited properties
  	this.root = options.root;
  	this.pElement = options.pElement;
  	this.context = options.context;
  	this.index = options.index;
  	this.key = options.key;
  	this.registeredIndexRefs = [];

  	// encapsulated styles should be inherited until they get applied by an element
  	this.cssIds = "cssIds" in options ? options.cssIds : this.parent ? this.parent.cssIds : null;

  	this.items = options.template.map(function (template, i) {
  		return createItem({
  			parentFragment: _this,
  			pElement: options.pElement,
  			template: template,
  			index: i
  		});
  	});

  	this.value = this.argsList = null;
  	this.dirtyArgs = this.dirtyValue = true;

  	this.bound = true;
  }

  function createItem(options) {
  	if (typeof options.template === "string") {
  		return new items_Text(options);
  	}

  	switch (options.template.t) {
  		case YIELDER:
  			return new items_Yielder(options);
  		case INTERPOLATOR:
  			return new items_Interpolator(options);
  		case SECTION:
  			return new _Section(options);
  		case TRIPLE:
  			return new _Triple(options);
  		case ELEMENT:
  			var constructor = undefined;
  			if (constructor = Component_getComponent(options.parentFragment.root, options.template.e)) {
  				return new _Component(options, constructor);
  			}
  			return new _Element(options);
  		case PARTIAL:
  			return new _Partial(options);
  		case COMMENT:
  			return new items_Comment(options);
  		case DOCTYPE:
  			return new items_Doctype(options);

  		default:
  			throw new Error("Something very strange happened. Please file an issue at https://github.com/ractivejs/ractive/issues. Thanks!");
  	}
  }

  var Fragment_prototype_rebind = Fragment$rebind;
  function Fragment$rebind(oldKeypath, newKeypath) {

  	// assign new context keypath if needed
  	if (!this.owner || this.owner.hasContext) {
  		assignNewKeypath(this, "context", oldKeypath, newKeypath);
  	}

  	this.items.forEach(function (item) {
  		if (item.rebind) {
  			item.rebind(oldKeypath, newKeypath);
  		}
  	});
  }

  var Fragment_prototype_render = Fragment$render;

  function Fragment$render() {
  	var result;

  	if (this.items.length === 1) {
  		result = this.items[0].render();
  	} else {
  		result = document.createDocumentFragment();

  		this.items.forEach(function (item) {
  			result.appendChild(item.render());
  		});
  	}

  	this.rendered = true;
  	return result;
  }

  var Fragment_prototype_toString = Fragment$toString;

  function Fragment$toString(escape) {
  	if (!this.items) {
  		return "";
  	}

  	return this.items.map(escape ? toEscapedString : Fragment_prototype_toString__toString).join("");
  }

  function Fragment_prototype_toString__toString(item) {
  	return item.toString();
  }

  function toEscapedString(item) {
  	return item.toString(true);
  }

  var Fragment_prototype_unbind = Fragment$unbind;

  function Fragment$unbind() {
  	if (!this.bound) {
  		return;
  	}

  	this.items.forEach(unbindItem);
  	this.bound = false;
  }

  function unbindItem(item) {
  	if (item.unbind) {
  		item.unbind();
  	}
  }

  var Fragment_prototype_unrender = Fragment$unrender;

  function Fragment$unrender(shouldDestroy) {
  	if (!this.rendered) {
  		throw new Error("Attempted to unrender a fragment that was not rendered");
  	}

  	this.items.forEach(function (i) {
  		return i.unrender(shouldDestroy);
  	});
  	this.rendered = false;
  }

  var Fragment = function (options) {
  	this.init(options);
  };

  Fragment.prototype = {
  	bubble: prototype_bubble,
  	detach: Fragment_prototype_detach,
  	find: Fragment_prototype_find,
  	findAll: Fragment_prototype_findAll,
  	findAllComponents: Fragment_prototype_findAllComponents,
  	findComponent: Fragment_prototype_findComponent,
  	findNextNode: prototype_findNextNode,
  	firstNode: prototype_firstNode,
  	getArgsList: getArgsList,
  	getNode: getNode,
  	getValue: prototype_getValue,
  	init: Fragment_prototype_init,
  	rebind: Fragment_prototype_rebind,
  	registerIndexRef: function (idx) {
  		var idxs = this.registeredIndexRefs;
  		if (idxs.indexOf(idx) === -1) {
  			idxs.push(idx);
  		}
  	},
  	render: Fragment_prototype_render,
  	toString: Fragment_prototype_toString,
  	unbind: Fragment_prototype_unbind,
  	unregisterIndexRef: function (idx) {
  		var idxs = this.registeredIndexRefs;
  		idxs.splice(idxs.indexOf(idx), 1);
  	},
  	unrender: Fragment_prototype_unrender
  };

  var virtualdom_Fragment = Fragment;

  var prototype_reset = Ractive$reset;
  var shouldRerender = ["template", "partials", "components", "decorators", "events"],
      resetHook = new hooks_Hook("reset");
  function Ractive$reset(data) {
  	var promise, wrapper, changes, i, rerender;

  	data = data || {};

  	if (typeof data !== "object") {
  		throw new Error("The reset method takes either no arguments, or an object containing new data");
  	}

  	// If the root object is wrapped, try and use the wrapper's reset value
  	if ((wrapper = this.viewmodel.wrapped[""]) && wrapper.reset) {
  		if (wrapper.reset(data) === false) {
  			// reset was rejected, we need to replace the object
  			this.viewmodel.reset(data);
  		}
  	} else {
  		this.viewmodel.reset(data);
  	}

  	// reset config items and track if need to rerender
  	changes = config_config.reset(this);

  	i = changes.length;
  	while (i--) {
  		if (shouldRerender.indexOf(changes[i]) > -1) {
  			rerender = true;
  			break;
  		}
  	}

  	if (rerender) {
  		var component = undefined;

  		this.viewmodel.mark(rootKeypath);

  		// Is this is a component, we need to set the `shouldDestroy`
  		// flag, otherwise it will assume by default that a parent node
  		// will be detached, and therefore it doesn't need to bother
  		// detaching its own nodes
  		if (component = this.component) {
  			component.shouldDestroy = true;
  		}

  		this.unrender();

  		if (component) {
  			component.shouldDestroy = false;
  		}

  		// If the template changed, we need to destroy the parallel DOM
  		// TODO if we're here, presumably it did?
  		if (this.fragment.template !== this.template) {
  			this.fragment.unbind();

  			this.fragment = new virtualdom_Fragment({
  				template: this.template,
  				root: this,
  				owner: this
  			});
  		}

  		promise = this.render(this.el, this.anchor);
  	} else {
  		promise = global_runloop.start(this, true);
  		this.viewmodel.mark(rootKeypath);
  		global_runloop.end();
  	}

  	resetHook.fire(this, data);

  	return promise;
  }

  var resetPartial = function (name, partial) {
  	var promise,
  	    collection = [];

  	function collect(source, dest, ractive) {
  		// if this is a component and it has its own partial, bail
  		if (ractive && ractive.partials[name]) return;

  		source.forEach(function (item) {
  			// queue to rerender if the item is a partial and the current name matches
  			if (item.type === PARTIAL && item.getPartialName() === name) {
  				dest.push(item);
  			}

  			// if it has a fragment, process its items
  			if (item.fragment) {
  				collect(item.fragment.items, dest, ractive);
  			}

  			// or if it has fragments
  			if (isArray(item.fragments)) {
  				collect(item.fragments, dest, ractive);
  			}

  			// or if it is itself a fragment, process its items
  			else if (isArray(item.items)) {
  				collect(item.items, dest, ractive);
  			}

  			// or if it is a component, step in and process its items
  			else if (item.type === COMPONENT && item.instance) {
  				collect(item.instance.fragment.items, dest, item.instance);
  			}

  			// if the item is an element, process its attributes too
  			if (item.type === ELEMENT) {
  				if (isArray(item.attributes)) {
  					collect(item.attributes, dest, ractive);
  				}

  				if (isArray(item.conditionalAttributes)) {
  					collect(item.conditionalAttributes, dest, ractive);
  				}
  			}
  		});
  	}

  	collect(this.fragment.items, collection);
  	this.partials[name] = partial;

  	promise = global_runloop.start(this, true);

  	collection.forEach(function (item) {
  		item.value = undefined;
  		item.setValue(name);
  	});

  	global_runloop.end();

  	return promise;
  };

  // TODO should resetTemplate be asynchronous? i.e. should it be a case
  // of outro, update template, intro? I reckon probably not, since that
  // could be achieved with unrender-resetTemplate-render. Also, it should
  // conceptually be similar to resetPartial, which couldn't be async

  var resetTemplate = Ractive$resetTemplate;
  function Ractive$resetTemplate(template) {
  	var transitionsEnabled, component;

  	template_template.init(null, this, { template: template });

  	transitionsEnabled = this.transitionsEnabled;
  	this.transitionsEnabled = false;

  	// Is this is a component, we need to set the `shouldDestroy`
  	// flag, otherwise it will assume by default that a parent node
  	// will be detached, and therefore it doesn't need to bother
  	// detaching its own nodes
  	if (component = this.component) {
  		component.shouldDestroy = true;
  	}

  	this.unrender();

  	if (component) {
  		component.shouldDestroy = false;
  	}

  	// remove existing fragment and create new one
  	this.fragment.unbind();
  	this.fragment = new virtualdom_Fragment({
  		template: this.template,
  		root: this,
  		owner: this
  	});

  	this.render(this.el, this.anchor);

  	this.transitionsEnabled = transitionsEnabled;
  }

  var reverse = makeArrayMethod("reverse");

  var Ractive_prototype_set = Ractive$set;

  function Ractive$set(keypath, value) {
  	var map, promise;

  	promise = global_runloop.start(this, true);

  	// Set multiple keypaths in one go
  	if (isObject(keypath)) {
  		map = keypath;

  		for (keypath in map) {
  			if (map.hasOwnProperty(keypath)) {
  				value = map[keypath];
  				set(this, keypath, value);
  			}
  		}
  	}

  	// Set a single keypath
  	else {
  		set(this, keypath, value);
  	}

  	global_runloop.end();

  	return promise;
  }

  function set(ractive, keypath, value) {
  	keypath = getKeypath(normalise(keypath));

  	if (keypath.isPattern) {
  		getMatchingKeypaths(ractive, keypath).forEach(function (keypath) {
  			ractive.viewmodel.set(keypath, value);
  		});
  	} else {
  		ractive.viewmodel.set(keypath, value);
  	}
  }

  var shift = makeArrayMethod("shift");

  var prototype_sort = makeArrayMethod("sort");

  var splice = makeArrayMethod("splice");

  var subtract = Ractive$subtract;
  function Ractive$subtract(keypath, d) {
  	return shared_add(this, keypath, d === undefined ? -1 : -d);
  }

  // Teardown. This goes through the root fragment and all its children, removing observers
  // and generally cleaning up after itself

  var Ractive_prototype_teardown = Ractive$teardown;

  var Ractive_prototype_teardown__teardownHook = new hooks_Hook("teardown");
  function Ractive$teardown() {
  	var promise;

  	this.fragment.unbind();
  	this.viewmodel.teardown();

  	this._observers.forEach(cancel);

  	if (this.fragment.rendered && this.el.__ractive_instances__) {
  		removeFromArray(this.el.__ractive_instances__, this);
  	}

  	this.shouldDestroy = true;
  	promise = this.fragment.rendered ? this.unrender() : utils_Promise.resolve();

  	Ractive_prototype_teardown__teardownHook.fire(this);

  	this._boundFunctions.forEach(deleteFunctionCopy);

  	return promise;
  }

  function deleteFunctionCopy(bound) {
  	delete bound.fn[bound.prop];
  }

  var toggle = Ractive$toggle;
  function Ractive$toggle(keypath) {
  	var _this = this;

  	if (typeof keypath !== "string") {
  		throw new TypeError(badArguments);
  	}

  	var changes = undefined;

  	if (/\*/.test(keypath)) {
  		changes = {};

  		getMatchingKeypaths(this, getKeypath(normalise(keypath))).forEach(function (keypath) {
  			changes[keypath.str] = !_this.viewmodel.get(keypath);
  		});

  		return this.set(changes);
  	}

  	return this.set(keypath, !this.get(keypath));
  }

  var toHTML = Ractive$toHTML;

  function Ractive$toHTML() {
  	return this.fragment.toString(true);
  }

  var Ractive_prototype_unrender = Ractive$unrender;
  var unrenderHook = new hooks_Hook("unrender");
  function Ractive$unrender() {
  	var promise, shouldDestroy;

  	if (!this.fragment.rendered) {
  		warnIfDebug("ractive.unrender() was called on a Ractive instance that was not rendered");
  		return utils_Promise.resolve();
  	}

  	promise = global_runloop.start(this, true);

  	// If this is a component, and the component isn't marked for destruction,
  	// don't detach nodes from the DOM unnecessarily
  	shouldDestroy = !this.component || this.component.shouldDestroy || this.shouldDestroy;

  	// Cancel any animations in progress
  	while (this._animations[0]) {
  		this._animations[0].stop(); // it will remove itself from the index
  	}

  	this.fragment.unrender(shouldDestroy);

  	removeFromArray(this.el.__ractive_instances__, this);

  	unrenderHook.fire(this);

  	global_runloop.end();
  	return promise;
  }

  var unshift = makeArrayMethod("unshift");

  var Ractive_prototype_update = Ractive$update;
  var updateHook = new hooks_Hook("update");
  function Ractive$update(keypath) {
  	var promise;

  	keypath = getKeypath(keypath) || rootKeypath;

  	promise = global_runloop.start(this, true);
  	this.viewmodel.mark(keypath);
  	global_runloop.end();

  	updateHook.fire(this, keypath);

  	return promise;
  }

  var prototype_updateModel = Ractive$updateModel;

  function Ractive$updateModel(keypath, cascade) {
  	var values, key, bindings;

  	if (typeof keypath === "string" && !cascade) {
  		bindings = this._twowayBindings[keypath];
  	} else {
  		bindings = [];

  		for (key in this._twowayBindings) {
  			if (!keypath || getKeypath(key).equalsOrStartsWith(keypath)) {
  				// TODO is this right?
  				bindings.push.apply(bindings, this._twowayBindings[key]);
  			}
  		}
  	}

  	values = consolidate(this, bindings);
  	return this.set(values);
  }

  function consolidate(ractive, bindings) {
  	var values = {},
  	    checkboxGroups = [];

  	bindings.forEach(function (b) {
  		var oldValue, newValue;

  		// special case - radio name bindings
  		if (b.radioName && !b.element.node.checked) {
  			return;
  		}

  		// special case - checkbox name bindings come in groups, so
  		// we want to get the value once at most
  		if (b.checkboxName) {
  			if (!checkboxGroups[b.keypath.str] && !b.changed()) {
  				checkboxGroups.push(b.keypath);
  				checkboxGroups[b.keypath.str] = b;
  			}

  			return;
  		}

  		oldValue = b.attribute.value;
  		newValue = b.getValue();

  		if (arrayContentsMatch(oldValue, newValue)) {
  			return;
  		}

  		if (!isEqual(oldValue, newValue)) {
  			values[b.keypath.str] = newValue;
  		}
  	});

  	// Handle groups of `<input type='checkbox' name='{{foo}}' ...>`
  	if (checkboxGroups.length) {
  		checkboxGroups.forEach(function (keypath) {
  			var binding, oldValue, newValue;

  			binding = checkboxGroups[keypath.str]; // one to represent the entire group
  			oldValue = binding.attribute.value;
  			newValue = binding.getValue();

  			if (!arrayContentsMatch(oldValue, newValue)) {
  				values[keypath.str] = newValue;
  			}
  		});
  	}

  	return values;
  }

  var prototype = {
  	add: prototype_add,
  	animate: prototype_animate,
  	detach: prototype_detach,
  	find: prototype_find,
  	findAll: prototype_findAll,
  	findAllComponents: prototype_findAllComponents,
  	findComponent: prototype_findComponent,
  	findContainer: findContainer,
  	findParent: findParent,
  	fire: prototype_fire,
  	get: prototype_get,
  	insert: insert,
  	merge: prototype_merge,
  	observe: observe,
  	observeOnce: observeOnce,
  	off: off,
  	on: on,
  	once: once,
  	pop: pop,
  	push: push,
  	render: prototype_render,
  	reset: prototype_reset,
  	resetPartial: resetPartial,
  	resetTemplate: resetTemplate,
  	reverse: reverse,
  	set: Ractive_prototype_set,
  	shift: shift,
  	sort: prototype_sort,
  	splice: splice,
  	subtract: subtract,
  	teardown: Ractive_prototype_teardown,
  	toggle: toggle,
  	toHTML: toHTML,
  	toHtml: toHTML,
  	unrender: Ractive_prototype_unrender,
  	unshift: unshift,
  	update: Ractive_prototype_update,
  	updateModel: prototype_updateModel
  };

  var wrapMethod = function (method, superMethod, force) {

  	if (force || needsSuper(method, superMethod)) {

  		return function () {

  			var hasSuper = ("_super" in this),
  			    _super = this._super,
  			    result;

  			this._super = superMethod;

  			result = method.apply(this, arguments);

  			if (hasSuper) {
  				this._super = _super;
  			}

  			return result;
  		};
  	} else {
  		return method;
  	}
  };

  function needsSuper(method, superMethod) {
  	return typeof superMethod === "function" && /_super/.test(method);
  }

  var unwrapExtended = unwrap;

  function unwrap(Child) {
  	var options = {};

  	while (Child) {
  		addRegistries(Child, options);
  		addOtherOptions(Child, options);

  		if (Child._Parent !== _Ractive) {
  			Child = Child._Parent;
  		} else {
  			Child = false;
  		}
  	}

  	return options;
  }

  function addRegistries(Child, options) {
  	config_registries.forEach(function (r) {
  		addRegistry(r.useDefaults ? Child.prototype : Child, options, r.name);
  	});
  }

  function addRegistry(target, options, name) {
  	var registry,
  	    keys = Object.keys(target[name]);

  	if (!keys.length) {
  		return;
  	}

  	if (!(registry = options[name])) {
  		registry = options[name] = {};
  	}

  	keys.filter(function (key) {
  		return !(key in registry);
  	}).forEach(function (key) {
  		return registry[key] = target[name][key];
  	});
  }

  function addOtherOptions(Child, options) {
  	Object.keys(Child.prototype).forEach(function (key) {
  		if (key === "computed") {
  			return;
  		}

  		var value = Child.prototype[key];

  		if (!(key in options)) {
  			options[key] = value._method ? value._method : value;
  		}

  		// is it a wrapped function?
  		else if (typeof options[key] === "function" && typeof value === "function" && options[key]._method) {

  			var result = undefined,
  			    needsSuper = value._method;

  			if (needsSuper) {
  				value = value._method;
  			}

  			// rewrap bound directly to parent fn
  			result = wrapMethod(options[key]._method, value);

  			if (needsSuper) {
  				result._method = result;
  			}

  			options[key] = result;
  		}
  	});
  }

  var _extend = _extend__extend;

  function _extend__extend() {
  	for (var _len = arguments.length, options = Array(_len), _key = 0; _key < _len; _key++) {
  		options[_key] = arguments[_key];
  	}

  	if (!options.length) {
  		return extendOne(this);
  	} else {
  		return options.reduce(extendOne, this);
  	}
  }

  function extendOne(Parent) {
  	var options = arguments[1] === undefined ? {} : arguments[1];

  	var Child, proto;

  	// if we're extending with another Ractive instance...
  	//
  	//   var Human = Ractive.extend(...), Spider = Ractive.extend(...);
  	//   var Spiderman = Human.extend( Spider );
  	//
  	// ...inherit prototype methods and default options as well
  	if (options.prototype instanceof _Ractive) {
  		options = unwrapExtended(options);
  	}

  	Child = function (options) {
  		if (!(this instanceof Child)) return new Child(options);
  		initialise(this, options);
  	};

  	proto = create(Parent.prototype);
  	proto.constructor = Child;

  	// Static properties
  	defineProperties(Child, {
  		// alias prototype as defaults
  		defaults: { value: proto },

  		// extendable
  		extend: { value: _extend__extend, writable: true, configurable: true },

  		// Parent - for IE8, can't use Object.getPrototypeOf
  		_Parent: { value: Parent }
  	});

  	// extend configuration
  	config_config.extend(Parent, proto, options);

  	custom_data.extend(Parent, proto, options);

  	if (options.computed) {
  		proto.computed = utils_object__extend(create(Parent.prototype.computed), options.computed);
  	}

  	Child.prototype = proto;

  	return Child;
  }

  var getNodeInfo = function (node) {
  	var info = {},
  	    priv,
  	    indices;

  	if (!node || !(priv = node._ractive)) {
  		return info;
  	}

  	info.ractive = priv.root;
  	info.keypath = priv.keypath.str;
  	info.index = {};

  	// find all index references and resolve them
  	if (indices = Resolvers_findIndexRefs(priv.proxy.parentFragment)) {
  		info.index = Resolvers_findIndexRefs.resolve(indices);
  	}

  	return info;
  };

  var Ractive, properties;

  // Main Ractive required object
  Ractive = function (options) {
  	if (!(this instanceof Ractive)) return new Ractive(options);
  	initialise(this, options);
  };

  // Ractive properties
  properties = {

  	// debug flag
  	DEBUG: { writable: true, value: true },
  	DEBUG_PROMISES: { writable: true, value: true },

  	// static methods:
  	extend: { value: _extend },
  	getNodeInfo: { value: getNodeInfo },
  	parse: { value: _parse },

  	// Namespaced constructors
  	Promise: { value: utils_Promise },

  	// support
  	svg: { value: svg },
  	magic: { value: environment__magic },

  	// version
  	VERSION: { value: "0.7.3" },

  	// Plugins
  	adaptors: { writable: true, value: {} },
  	components: { writable: true, value: {} },
  	decorators: { writable: true, value: {} },
  	easing: { writable: true, value: static_easing },
  	events: { writable: true, value: {} },
  	interpolators: { writable: true, value: static_interpolators },
  	partials: { writable: true, value: {} },
  	transitions: { writable: true, value: {} }
  };

  // Ractive properties
  defineProperties(Ractive, properties);

  Ractive.prototype = utils_object__extend(prototype, config_defaults);

  Ractive.prototype.constructor = Ractive;

  // alias prototype as defaults
  Ractive.defaults = Ractive.prototype;

  // Ractive.js makes liberal use of things like Array.prototype.indexOf. In
  // older browsers, these are made available via a shim - here, we do a quick
  // pre-flight check to make sure that either a) we're not in a shit browser,
  // or b) we're using a Ractive-legacy.js build
  var FUNCTION = "function";

  if (typeof Date.now !== FUNCTION || typeof String.prototype.trim !== FUNCTION || typeof Object.keys !== FUNCTION || typeof Array.prototype.indexOf !== FUNCTION || typeof Array.prototype.forEach !== FUNCTION || typeof Array.prototype.map !== FUNCTION || typeof Array.prototype.filter !== FUNCTION || typeof window !== "undefined" && typeof window.addEventListener !== FUNCTION) {
  	throw new Error("It looks like you're attempting to use Ractive.js in an older browser. You'll need to use one of the 'legacy builds' in order to continue - see http://docs.ractivejs.org/latest/legacy-builds for more information.");
  }

  var _Ractive = Ractive;

  return _Ractive;

}));


},{}],81:[function(require,module,exports){
(function() {
  'use strict';

  if (self.fetch) {
    return
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name)
    }
    if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)) {
      throw new TypeError('Invalid character in header field name')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value)
    }
    return value
  }

  function Headers(headers) {
    this.map = {}

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value)
      }, this)

    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name])
      }, this)
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name)
    value = normalizeValue(value)
    var list = this.map[name]
    if (!list) {
      list = []
      this.map[name] = list
    }
    list.push(value)
  }

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)]
  }

  Headers.prototype.get = function(name) {
    var values = this.map[normalizeName(name)]
    return values ? values[0] : null
  }

  Headers.prototype.getAll = function(name) {
    return this.map[normalizeName(name)] || []
  }

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  }

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = [normalizeValue(value)]
  }

  Headers.prototype.forEach = function(callback, thisArg) {
    Object.getOwnPropertyNames(this.map).forEach(function(name) {
      this.map[name].forEach(function(value) {
        callback.call(thisArg, value, name, this)
      }, this)
    }, this)
  }

  function consumed(body) {
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result)
      }
      reader.onerror = function() {
        reject(reader.error)
      }
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader()
    reader.readAsArrayBuffer(blob)
    return fileReaderReady(reader)
  }

  function readBlobAsText(blob) {
    var reader = new FileReader()
    reader.readAsText(blob)
    return fileReaderReady(reader)
  }

  var support = {
    blob: 'FileReader' in self && 'Blob' in self && (function() {
      try {
        new Blob();
        return true
      } catch(e) {
        return false
      }
    })(),
    formData: 'FormData' in self
  }

  function Body() {
    this.bodyUsed = false


    this._initBody = function(body) {
      this._bodyInit = body
      if (typeof body === 'string') {
        this._bodyText = body
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body
      } else if (!body) {
        this._bodyText = ''
      } else {
        throw new Error('unsupported BodyInit type')
      }
    }

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this)
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      }

      this.arrayBuffer = function() {
        return this.blob().then(readBlobAsArrayBuffer)
      }

      this.text = function() {
        var rejected = consumed(this)
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return readBlobAsText(this._bodyBlob)
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as text')
        } else {
          return Promise.resolve(this._bodyText)
        }
      }
    } else {
      this.text = function() {
        var rejected = consumed(this)
        return rejected ? rejected : Promise.resolve(this._bodyText)
      }
    }

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      }
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    }

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']

  function normalizeMethod(method) {
    var upcased = method.toUpperCase()
    return (methods.indexOf(upcased) > -1) ? upcased : method
  }

  function Request(input, options) {
    options = options || {}
    var body = options.body
    if (Request.prototype.isPrototypeOf(input)) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url
      this.credentials = input.credentials
      if (!options.headers) {
        this.headers = new Headers(input.headers)
      }
      this.method = input.method
      this.mode = input.mode
      if (!body) {
        body = input._bodyInit
        input.bodyUsed = true
      }
    } else {
      this.url = input
    }

    this.credentials = options.credentials || this.credentials || 'omit'
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers)
    }
    this.method = normalizeMethod(options.method || this.method || 'GET')
    this.mode = options.mode || this.mode || null
    this.referrer = null

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body)
  }

  Request.prototype.clone = function() {
    return new Request(this)
  }

  function decode(body) {
    var form = new FormData()
    body.trim().split('&').forEach(function(bytes) {
      if (bytes) {
        var split = bytes.split('=')
        var name = split.shift().replace(/\+/g, ' ')
        var value = split.join('=').replace(/\+/g, ' ')
        form.append(decodeURIComponent(name), decodeURIComponent(value))
      }
    })
    return form
  }

  function headers(xhr) {
    var head = new Headers()
    var pairs = xhr.getAllResponseHeaders().trim().split('\n')
    pairs.forEach(function(header) {
      var split = header.trim().split(':')
      var key = split.shift().trim()
      var value = split.join(':').trim()
      head.append(key, value)
    })
    return head
  }

  Body.call(Request.prototype)

  function Response(bodyInit, options) {
    if (!options) {
      options = {}
    }

    this._initBody(bodyInit)
    this.type = 'default'
    this.status = options.status
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = options.statusText
    this.headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers)
    this.url = options.url || ''
  }

  Body.call(Response.prototype)

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  }

  Response.error = function() {
    var response = new Response(null, {status: 0, statusText: ''})
    response.type = 'error'
    return response
  }

  var redirectStatuses = [301, 302, 303, 307, 308]

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  }

  self.Headers = Headers;
  self.Request = Request;
  self.Response = Response;

  self.fetch = function(input, init) {
    return new Promise(function(resolve, reject) {
      var request
      if (Request.prototype.isPrototypeOf(input) && !init) {
        request = input
      } else {
        request = new Request(input, init)
      }

      var xhr = new XMLHttpRequest()

      function responseURL() {
        if ('responseURL' in xhr) {
          return xhr.responseURL
        }

        // Avoid security warnings on getResponseHeader when not allowed by CORS
        if (/^X-Request-URL:/m.test(xhr.getAllResponseHeaders())) {
          return xhr.getResponseHeader('X-Request-URL')
        }

        return;
      }

      xhr.onload = function() {
        var status = (xhr.status === 1223) ? 204 : xhr.status
        if (status < 100 || status > 599) {
          reject(new TypeError('Network request failed'))
          return
        }
        var options = {
          status: status,
          statusText: xhr.statusText,
          headers: headers(xhr),
          url: responseURL()
        }
        var body = 'response' in xhr ? xhr.response : xhr.responseText;
        resolve(new Response(body, options))
      }

      xhr.onerror = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.open(request.method, request.url, true)

      if (request.credentials === 'include') {
        xhr.withCredentials = true
      }

      if ('responseType' in xhr && support.blob) {
        xhr.responseType = 'blob'
      }

      request.headers.forEach(function(value, name) {
        xhr.setRequestHeader(name, value)
      })

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit)
    })
  }
  self.fetch.polyfill = true
})();

},{}],82:[function(require,module,exports){
'use strict';

var Ractive = require('ractive'),
    mqtt = require('mqtt'),
    Promise = require('es6-promise').Promise,
    url = require('url');

// WHAT-WG Fetch API polyfill
require('whatwg-fetch');

// Start
init();

function init() {
  Promise.all([fetchTemplateAndInitUi(), fetchConfigAndCreateClient()]).then(function (params) {
    var ui = params[0],
        client = params[1];
    subscribeMessagesToUi(ui, client);
  })['catch'](function (err) {
    console.error(err);
  });
}

function fetchConfigAndCreateClient() {
  return fetchConfig().then(createClientAndSubscribe);
}

function fetchConfig() {
  return fetch('config.json').then(function (res) {
    return res.json();
  });
}

function createClientAndSubscribe(config) {
  var topic = '#',
      brokerUrl = url.format({
    protocol: 'wss',
    hostname: config.broker.hostname,
    port: config.broker.wsPort
  });
  console.log('brokerUrl', brokerUrl);
  return new Promise(function (resolve, reject) {
    var client = mqtt.connect(brokerUrl);
    client.on('connect', function () {
      resolve(client);
    });
  });
}

function fetchTemplateAndInitUi() {
  return fetchTemplate().then(initUiWithTemplate);
}

function fetchTemplate() {
  return fetch('ui.tmpl').then(function (res) {
    return res.text();
  });
}

function initUiWithTemplate(template) {
  return new Ractive({
    el: '#container',
    template: template,
    data: {
      timeSecs: 1,
      iso: 400,
      lightLevelRaw: 0
    },
    computed: {
      lightLevel: function lightLevel() {
        return 1024 - this.get('lightLevelRaw');
      },
      lightLevelPercent: function lightLevelPercent() {
        return Math.floor(this.get('lightLevel') / 1024 * 100);
      }
    }
  });
}

function subscribeMessagesToUi(ui, client) {
  var lightLevelTopic = 'ciot/lightmeter/value';
  client.subscribe(lightLevelTopic);
  client.on('message', function (topic, msg) {
    if (lightLevelTopic === topic) {
      ui.animate('lightLevelRaw', msg.toString());
    }
  });
}

},{"es6-promise":33,"mqtt":35,"ractive":80,"url":30,"whatwg-fetch":81}]},{},[82]);
