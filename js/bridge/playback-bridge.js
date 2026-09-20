/**
 * AXIOM Reader Playback Bridge (Phase 0 Baseline)
 * 
 * Version: 1.0.0
 * 
 * Purpose:
 * Platform-neutral seam separating document presentation and reading UI
 * from audio execution. Works in standalone web mode (adapting to browser Web Audio/TTS)
 * and in native mobile shells (Capacitor Media3/AVFoundation services).
 * 
 * Guarantees:
 * - Preserves existing IndexedDB stores and reading anchors without schema changes.
 * - Supports local synthesis, cloud audio chunks, and un-cached text passages.
 * - Provides bidirectional state synchronization between UI and native foreground services.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AxiomPlaybackBridge = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BRIDGE_VERSION = '1.0.0';

  const PlaybackState = Object.freeze({
    IDLE: 'idle',
    BUFFERING: 'buffering',
    PLAYING: 'playing',
    PAUSED: 'paused',
    STOPPED: 'stopped',
    ERROR: 'error'
  });

  class PlaybackBridge {
    constructor() {
      this.version = BRIDGE_VERSION;
      this.state = PlaybackState.IDLE;
      this.queue = null;
      this.currentIndex = -1;
      this.currentSpeed = 1.0;
      this.nativePlugin = null;
      this.listeners = {
        stateChange: new Set(),
        transportCommand: new Set(),
        positionChange: new Set(),
        itemComplete: new Set(),
        error: new Set(),
        queueEnded: new Set()
      };
      this.nativeSubscribers = [];
      this._adapter = null; // Optional web or mock adapter
    }

    /**
     * Initializes the bridge and discovers native shell capabilities if available.
     * @param {Object} [options]
     * @param {Object} [options.adapter] Optional custom or web fallback adapter
     * @returns {Promise<boolean>} Resolves true if native shell is detected, false if web fallback
     */
    async init(options = {}) {
      if (options.adapter) {
        this._adapter = options.adapter;
      }

      // Check for Capacitor native shell
      const hasCapacitor = typeof window !== 'undefined' &&
        window.Capacitor &&
        (typeof window.Capacitor.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web'));

      if (hasCapacitor) {
        let plugin = (window.Capacitor.Plugins && window.Capacitor.Plugins.AxiomPlayback) ? window.Capacitor.Plugins.AxiomPlayback : null;
        if (!plugin && typeof window.Capacitor.registerPlugin === 'function') {
          try {
            plugin = window.Capacitor.registerPlugin('AxiomPlayback');
          } catch (err) {
            console.warn('[Bridge] registerPlugin AxiomPlayback failed:', err);
          }
        }
        if (plugin) {
          this.nativePlugin = plugin;
          this._setupNativeListeners();
          console.info('[Bridge] Connected to native AxiomPlayback plugin');
          return true;
        }
      }

      // Check for generic injected native host bridge
      if (typeof window !== 'undefined' && window.AxiomNativePlayback) {
        this.nativePlugin = window.AxiomNativePlayback;
        this._setupNativeListeners();
        return true;
      }

      return false;
    }

    /**
     * Returns true if currently backed by a platform-native playback service.
     */
    isNative() {
      if (this.nativePlugin !== null) return true;
      if (typeof window !== 'undefined' && window.Capacitor) {
        let p = (window.Capacitor.Plugins && window.Capacitor.Plugins.AxiomPlayback) ? window.Capacitor.Plugins.AxiomPlayback : null;
        if (!p && typeof window.Capacitor.registerPlugin === 'function') {
          try { p = window.Capacitor.registerPlugin('AxiomPlayback'); } catch (_) {}
        }
        if (p) {
          this.nativePlugin = p;
          this._setupNativeListeners();
          return true;
        }
      }
      return false;
    }

    /**
     * Registers a listener for bridge events.
     * @param {'stateChange'|'positionChange'|'itemComplete'|'error'|'queueEnded'} event
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].add(callback);
        return () => this.listeners[event].delete(callback);
      }
      return () => {};
    }

    /**
     * Dispatches an event to registered listeners.
     * @private
     */
    _emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try { cb(data); } catch (e) { console.error(`[Bridge] Error in ${event} listener:`, e); }
        });
      }
    }

    /**
     * Sets internal state and notifies subscribers.
     * @private
     */
    _setState(newState, details = {}) {
      if (this.state !== newState) {
        const previousState = this.state;
        this.state = newState;
        this._emit('stateChange', { state: newState, previousState, ...details });
      }
    }

    /**
     * Prepares and loads a document narration queue into the playback engine.
     * @param {Object} queueData
     * @param {string|number} queueData.documentId
     * @param {string} queueData.title
     * @param {Array<Object>} queueData.items
     * @param {number} [queueData.startIndex=0]
     * @param {number} [queueData.speed=1.0]
     * @param {Object} [queueData.anchor] Reading anchor { blockIdx, text, occurrence }
     */
    async loadQueue(queueData) {
      if (!queueData || !Array.isArray(queueData.items)) {
        throw new Error('[Bridge] Invalid queue data: items array required.');
      }

      const normalizedQueue = {
        documentId: queueData.documentId || 'unknown',
        title: queueData.title || 'Untitled Document',
        playbackOwner: queueData.playbackOwner === 'web' ? 'web' : 'native',
        startIndex: Math.max(0, Math.min(queueData.items.length - 1, queueData.startIndex || 0)),
        speed: Number(queueData.speed) || 1.0,
        anchor: queueData.anchor || null,
        items: queueData.items.map((item, idx) => ({
          index: typeof item.index === 'number' ? item.index : idx,
          blockIdx: typeof item.blockIdx === 'number' ? item.blockIdx : idx,
          text: item.text || '',
          speechText: item.speechText || item.text || '',
          audioUri: item.audioUri || null,
          timings: Array.isArray(item.timings) ? item.timings : null
        }))
      };

      this.queue = normalizedQueue;
      this.currentIndex = normalizedQueue.startIndex;
      this.currentSpeed = normalizedQueue.speed;

      if (this.isNative()) {
        try {
          await this.nativePlugin.loadQueue(normalizedQueue);
        } catch (err) {
          this._setState(PlaybackState.ERROR, { error: err });
          this._emit('error', err);
          throw err;
        }
        this.state = PlaybackState.STOPPED;
      } else if (this._adapter && typeof this._adapter.loadQueue === 'function') {
        await this._adapter.loadQueue(normalizedQueue);
        this._setState(PlaybackState.STOPPED, { queue: this.queue });
      } else {
        this._setState(PlaybackState.STOPPED, { queue: this.queue });
      }

      return true;
    }

    /**
     * Starts or resumes playback.
     */
    async play() {
      if (!this.queue || this.queue.items.length === 0) {
        throw new Error('[Bridge] Cannot play: No queue loaded.');
      }

      this._setState(PlaybackState.BUFFERING);

      if (this.isNative()) {
        try {
          await this.nativePlugin.play();
        } catch (err) {
          this._setState(PlaybackState.ERROR, { error: err });
          this._emit('error', err);
          throw err;
        }
      } else if (this._adapter && typeof this._adapter.play === 'function') {
        await this._adapter.play();
      }

      this._setState(PlaybackState.PLAYING);
    }

    /**
     * Pauses playback.
     */
    async pause() {
      if (!this.isNative() && (this.state === PlaybackState.IDLE || this.state === PlaybackState.STOPPED)) return;

      if (this.isNative()) {
        try {
          await this.nativePlugin.pause();
        } catch (err) {
          this._setState(PlaybackState.ERROR, { error: err });
          this._emit('error', err);
          throw err;
        }
      } else if (this._adapter && typeof this._adapter.pause === 'function') {
        await this._adapter.pause();
      }

      this._setState(PlaybackState.PAUSED);
    }

    /**
     * Stops playback and resets active sentence position to starting anchor or stop position.
     */
    async stop() {
      if (this.state === PlaybackState.STOPPED || this.state === PlaybackState.IDLE) return;

      if (this.isNative()) {
        try {
          await this.nativePlugin.stop();
        } catch (err) {
          this._setState(PlaybackState.ERROR, { error: err });
          this._emit('error', err);
          throw err;
        }
      } else if (this._adapter && typeof this._adapter.stop === 'function') {
        await this._adapter.stop();
      }

      this._setState(PlaybackState.STOPPED);
    }

    /**
     * Seeks to a specific sentence index or jumps by an offset.
     * @param {Object} target
     * @param {number} [target.sentenceIndex] Direct index in queue
     * @param {number} [target.deltaSentences] Relative jump in sentences (+1, -1, etc.)
     * @param {number} [target.deltaSeconds] Relative jump in seconds
     */
    async seek(target = {}) {
      if (!this.queue || this.queue.items.length === 0) return;

      let targetIndex = this.currentIndex;
      if (typeof target.sentenceIndex === 'number') {
        targetIndex = target.sentenceIndex;
      } else if (typeof target.deltaSentences === 'number') {
        targetIndex += target.deltaSentences;
      }

      targetIndex = Math.max(0, Math.min(this.queue.items.length - 1, targetIndex));
      this.currentIndex = targetIndex;

      if (this.isNative()) {
        await this.nativePlugin.seek({
          sentenceIndex: targetIndex,
          deltaSeconds: target.deltaSeconds || 0
        });
      } else if (this._adapter && typeof this._adapter.seek === 'function') {
        await this._adapter.seek({
          sentenceIndex: targetIndex,
          deltaSeconds: target.deltaSeconds || 0
        });
      }

      const currentItem = this.queue.items[targetIndex];
      this._emit('positionChange', {
        index: targetIndex,
        blockIdx: currentItem.blockIdx,
        offsetSeconds: 0
      });
    }

    /**
     * Sets playback speed rate.
     * @param {number} rate
     */
    async setSpeed(rate) {
      const normalizedRate = Math.max(0.5, Math.min(3.0, Number(rate) || 1.0));
      this.currentSpeed = normalizedRate;

      if (this.isNative()) {
        await this.nativePlugin.setSpeed({ speed: normalizedRate });
      } else if (this._adapter && typeof this._adapter.setSpeed === 'function') {
        await this._adapter.setSpeed(normalizedRate);
      }
    }

    /**
     * Queries available voices from the native TTS engine or host adapter.
     * @returns {Promise<Array<{ name: string, locale: string, quality?: string, network?: string }>>}
     */
    async getVoices() {
      if (this.isNative() && typeof this.nativePlugin.getVoices === 'function') {
        try {
          const res = await this.nativePlugin.getVoices();
          return (res && Array.isArray(res.voices)) ? res.voices : [];
        } catch (err) {
          console.warn('[Bridge] Error getting native voices:', err);
          return [];
        }
      } else if (this._adapter && typeof this._adapter.getVoices === 'function') {
        return await this._adapter.getVoices();
      }
      return [];
    }

    /**
     * Sets the active native TTS voice.
     * @param {string} voiceName
     */
    async setVoice(voiceName) {
      if (this.isNative() && typeof this.nativePlugin.setVoice === 'function') {
        try {
          await this.nativePlugin.setVoice({ voiceName });
        } catch (err) {
          console.warn('[Bridge] Error setting native voice:', err);
        }
      } else if (this._adapter && typeof this._adapter.setVoice === 'function') {
        await this._adapter.setVoice(voiceName);
      }
    }

    /**
     * Updates native playback service with current playback state and active sentence index.
     * Keeps Wear OS, Lock Screen, and Android Auto metadata in sync during cloud or local speech.
     * @param {Object} options
     * @param {string} options.state 'playing' | 'paused' | 'stopped'
     * @param {number} [options.index] Current sentence index
     */
    async setPlaybackState(options) {
      if (this.isNative() && typeof this.nativePlugin.setPlaybackState === 'function') {
        try {
          await this.nativePlugin.setPlaybackState(options || {});
        } catch (err) {
          console.warn('[Bridge] Error in setPlaybackState:', err);
        }
      }
    }

    /**
     * Queries native playback service for live background playback state and active sentence index.
     * @returns {Promise<Object|null>}
     */
    async getNativePlaybackState() {
      if (this.isNative() && typeof this.nativePlugin.getPlaybackState === 'function') {
        try {
          return await this.nativePlugin.getPlaybackState();
        } catch (err) {
          console.warn('[Bridge] Error querying native playback state:', err);
        }
      }
      return null;
    }

    /**
     * Speaks an immediate standalone sentence for voice preview without replacing the reading queue.
     * @param {Object} options
     * @param {string} options.text
     * @param {number} [options.speed=1.0]
     */
    async speakText(options = {}) {
      const text = typeof options === 'string' ? options : (options.text || '');
      const speed = Number(options.speed) || 1.0;
      if (this.isNative() && typeof this.nativePlugin.speakText === 'function') {
        try {
          await this.nativePlugin.speakText({ text, speed });
        } catch (err) {
          console.warn('[Bridge] Error in speakText:', err);
        }
      }
    }

    /**
     * Returns current state, position, and active item.
     */
    getQueueState() {
      const activeItem = this.queue && this.currentIndex >= 0 ? this.queue.items[this.currentIndex] : null;
      return {
        version: this.version,
        isNative: this.isNative(),
        state: this.state,
        currentIndex: this.currentIndex,
        speed: this.currentSpeed,
        totalItems: this.queue ? this.queue.items.length : 0,
        activeItem
      };
    }

    /**
     * Subscribes to native events from Capacitor or host plugin.
     * @private
     */
    _setupNativeListeners() {
      if (!this.nativePlugin || typeof this.nativePlugin.addListener !== 'function') return;

      const subCommand = this.nativePlugin.addListener('onTransportCommand', (event) => {
        this._emit('transportCommand', event);
      });
      this.nativeSubscribers.push(subCommand);

      const subState = this.nativePlugin.addListener('onPlaybackStateChanged', (event) => {
        this._setState(event.state, { ...event, origin: 'native' });
      });
      const subPos = this.nativePlugin.addListener('onPositionChanged', (event) => {
        this.currentIndex = event.index;
        this._emit('positionChange', event);
      });
      const subComplete = this.nativePlugin.addListener('onItemCompleted', (event) => {
        this._emit('itemComplete', event);
      });
      const subEnd = this.nativePlugin.addListener('onQueueEnded', (event) => {
        this._setState(PlaybackState.STOPPED);
        this._emit('queueEnded', event);
      });
      const subErr = this.nativePlugin.addListener('onError', (event) => {
        this._setState(PlaybackState.ERROR, event);
        this._emit('error', event);
      });

      this.nativeSubscribers.push(subState, subPos, subComplete, subEnd, subErr);
    }
  }

  const defaultBridge = new PlaybackBridge();
  if (typeof window !== 'undefined') {
    window.axiomBridge = defaultBridge;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        defaultBridge.init().catch(() => {});
      });
    } else {
      defaultBridge.init().catch(() => {});
    }
  }

  return {
    BRIDGE_VERSION,
    PlaybackState,
    PlaybackBridge,
    defaultBridge
  };
});
