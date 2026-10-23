// Local stand-in for Google's API loader (https://apis.google.com/js/api.js), served
// to the browser by the signed-in e2e fixtures instead of the real script.
//
// Popup sign-in, even against the Auth emulator, opens a helper iframe and talks to
// it through the loader's `gapi.iframes` channel. Both sides load this file: the app
// page (through Firebase Auth) and the Auth emulator's helper iframe
// (/emulator/auth/iframe). It implements only what those two use, over
// window.postMessage, so sign-in works with no request leaving the machine:
// - gapi.load('gapi.iframes', { callback }) and the `?onload=` / `gapi_onload` hooks
// - parent side: gapi.iframes.getContext().open(options, onOpen) with an iframe
//   handle offering register, send, ping and restyle
// - child side: gapi.iframes.getContext().getParentIframe() with register and send
;(function () {
  'use strict'
  var TAG = '__solaraFakeGapi'
  var nextId = 1

  /**
   * Like the real loader, a throwing handler or callback never breaks the channel.
   * (Firebase Auth's web-storage probe, for one, always throws after answering.)
   */
  function safely(fn, arg) {
    try {
      return fn(arg)
    } catch (_error) {
      return undefined
    }
  }

  /** One end of a channel to `target`, a window on the other side. */
  function Channel(getTarget) {
    this.getTarget = getTarget
    this.handlers = {}
    this.pendingCalls = []
    this.callbacks = {}
    this.ready = false
    this.readyWaiters = []
  }
  Channel.prototype.post = function (message) {
    var target = this.getTarget()
    if (target) target.postMessage(Object.assign({ tag: TAG }, message), '*')
  }
  Channel.prototype.register = function (type, handler) {
    this.handlers[type] = handler
    // Calls that arrived before the handler existed are answered now.
    var waiting = this.pendingCalls.filter(function (call) {
      return call.type === type
    })
    this.pendingCalls = this.pendingCalls.filter(function (call) {
      return call.type !== type
    })
    for (var i = 0; i < waiting.length; i++) this.answer(waiting[i])
  }
  Channel.prototype.answer = function (call) {
    var result = safely(this.handlers[call.type], call.data)
    this.post({ kind: 'reply', id: call.id, responses: [result] })
  }
  Channel.prototype.send = function (type, data, callback) {
    var id = String(nextId++)
    if (callback) this.callbacks[id] = callback
    this.post({ kind: 'call', id: id, type: type, data: data })
  }
  Channel.prototype.markReady = function () {
    this.ready = true
    var waiters = this.readyWaiters
    this.readyWaiters = []
    for (var i = 0; i < waiters.length; i++) waiters[i]()
  }
  Channel.prototype.ping = function (callback) {
    return new Promise(resolve => {
      const done = () => {
        if (callback) safely(callback)
        resolve()
      }
      if (this.ready) done()
      else this.readyWaiters.push(done)
    })
  }
  Channel.prototype.restyle = function () {
    return Promise.resolve()
  }
  Channel.prototype.receive = function (message) {
    if (message.kind === 'ready') {
      this.markReady()
    } else if (message.kind === 'call') {
      if (this.handlers[message.type]) this.answer(message)
      else this.pendingCalls.push(message)
    } else if (message.kind === 'reply') {
      var callback = this.callbacks[message.id]
      delete this.callbacks[message.id]
      if (callback) safely(callback, message.responses)
    }
  }

  /** Channels by the window on their other side. */
  var channels = []
  window.addEventListener('message', function (event) {
    var message = event.data
    if (!message || message.tag !== TAG) return
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].getTarget() === event.source) channels[i].receive(message)
    }
  })

  var context = {
    open: function (options, onOpen) {
      var frame = document.createElement('iframe')
      var attributes = options.attributes || {}
      Object.keys(attributes).forEach(function (name) {
        if (name === 'style') Object.assign(frame.style, attributes.style)
        else frame.setAttribute(name, attributes[name])
      })
      var channel = new Channel(function () {
        return frame.contentWindow
      })
      channels.push(channel)
      frame.src = options.url
      ;(options.where || document.body).appendChild(frame)
      return Promise.resolve(onOpen ? onOpen(channel) : channel)
    },
    getParentIframe: function () {
      var channel = new Channel(function () {
        return window.parent
      })
      channels.push(channel)
      channel.post({ kind: 'ready' })
      return channel
    },
  }

  function Iframe() {}

  window.gapi = window.gapi || {}
  window.gapi.iframes = {
    CROSS_ORIGIN_IFRAMES_FILTER: function () {
      return true
    },
    Iframe: Iframe,
    getContext: function () {
      return context
    },
  }
  window.gapi.load = function (_name, options) {
    var callback = typeof options === 'function' ? options : options && options.callback
    setTimeout(function () {
      if (callback) callback()
    }, 0)
  }

  // The real loader calls `?onload=<name>` from its URL, then window.gapi_onload.
  var script = document.currentScript
  var onload = script && script.src ? new URL(script.src).searchParams.get('onload') : null
  setTimeout(function () {
    if (onload && typeof window[onload] === 'function') window[onload]()
    if (typeof window.gapi_onload === 'function') window.gapi_onload()
  }, 0)
})()
