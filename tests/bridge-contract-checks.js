(async () => {
  const results = [];
  function check(name, condition) {
    results.push(`${condition ? 'PASS' : 'FAIL'} — ${name}`);
  }

  const { BRIDGE_VERSION, PlaybackState, PlaybackBridge } = window.AxiomPlaybackBridge || {};

  try {
    // Check 1: Module exports and versioning
    check('Bridge exports correct specification version (1.0.0)', BRIDGE_VERSION === '1.0.0');
    check('Bridge defines valid playback state enum',
      PlaybackState.IDLE === 'idle' &&
      PlaybackState.PLAYING === 'playing' &&
      PlaybackState.PAUSED === 'paused' &&
      PlaybackState.STOPPED === 'stopped' &&
      PlaybackState.BUFFERING === 'buffering' &&
      PlaybackState.ERROR === 'error'
    );

    // Check 2: Browser standalone detection
    const bridge = new PlaybackBridge();
    const isNativeDetected = await bridge.init();
    check('Default web reader runs in standalone browser mode', isNativeDetected === false && !bridge.isNative());
    check('Initial bridge state is IDLE', bridge.state === PlaybackState.IDLE);

    // Check 3: Queue validation and error handling
    let threwOnEmpty = false;
    try {
      await bridge.loadQueue(null);
    } catch (_) {
      threwOnEmpty = true;
    }
    check('Loading null/invalid queue rejects gracefully', threwOnEmpty);

    // Check 4: Loading local TTS queue (no audioUri cached)
    const localItems = [
      { index: 0, blockIdx: 1, text: 'First test sentence.', speechText: 'First test sentence.' },
      { index: 1, blockIdx: 2, text: 'Second test sentence.', speechText: 'Second test sentence.' },
      { index: 2, blockIdx: 3, text: 'Third test sentence.', speechText: 'Third test sentence.' }
    ];

    await bridge.loadQueue({
      documentId: 'doc-123',
      title: 'Local Test Document',
      items: localItems,
      startIndex: 0,
      speed: 1.2,
      anchor: { blockIdx: 1, text: 'First test sentence.', occurrence: 0 }
    });

    const stateAfterLoad = bridge.getQueueState();
    check('Queue loads with local TTS items and stopped state',
      bridge.state === PlaybackState.STOPPED &&
      stateAfterLoad.totalItems === 3 &&
      stateAfterLoad.speed === 1.2 &&
      stateAfterLoad.currentIndex === 0 &&
      stateAfterLoad.activeItem.text === 'First test sentence.'
    );

    // Check 5: Loading cloud audio chunk queue with timing marks
    const cloudItems = [
      {
        index: 0,
        blockIdx: 10,
        text: 'Cloud synthesized passage.',
        speechText: 'Cloud synthesized passage.',
        audioUri: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        timings: [{ segmentIndex: 0, timeSeconds: 0 }, { segmentIndex: 1, timeSeconds: 0.8 }]
      }
    ];

    await bridge.loadQueue({
      documentId: 'doc-cloud',
      title: 'Cloud Audio Document',
      items: cloudItems,
      startIndex: 0
    });

    check('Queue supports pre-rendered cloud audio chunks and timing metadata',
      bridge.queue.items[0].audioUri !== null &&
      Array.isArray(bridge.queue.items[0].timings) &&
      bridge.queue.items[0].timings.length === 2
    );

    // Check 6: State transition events & Playback lifecycle
    const stateHistory = [];
    const unsubState = bridge.on('stateChange', evt => stateHistory.push(evt.state));

    // Reload local items
    await bridge.loadQueue({
      documentId: 'doc-lifecycle',
      title: 'Lifecycle Document',
      items: localItems
    });

    await bridge.play();
    check('Playing transition emits buffering then playing state',
      bridge.state === PlaybackState.PLAYING &&
      stateHistory.includes(PlaybackState.BUFFERING) &&
      stateHistory.includes(PlaybackState.PLAYING)
    );

    await bridge.pause();
    check('Pausing transitions to PAUSED state', bridge.state === PlaybackState.PAUSED);

    await bridge.stop();
    check('Stopping transitions to STOPPED state', bridge.state === PlaybackState.STOPPED);
    unsubState();

    // Check 7: Position seeking and boundaries
    const positionHistory = [];
    bridge.on('positionChange', pos => positionHistory.push(pos.index));

    await bridge.seek({ sentenceIndex: 2 });
    check('Seek to specific index updates currentIndex and emits positionChange',
      bridge.currentIndex === 2 && positionHistory.includes(2)
    );

    await bridge.seek({ deltaSentences: -1 });
    check('Relative sentence jump navigates queue backward', bridge.currentIndex === 1);

    await bridge.seek({ sentenceIndex: 999 }); // Out of bounds high
    check('Seek clamps to maximum queue length', bridge.currentIndex === localItems.length - 1);

    await bridge.seek({ sentenceIndex: -5 }); // Out of bounds low
    check('Seek clamps to minimum queue index 0', bridge.currentIndex === 0);

    // Check 8: Speed normalization
    await bridge.setSpeed(1.5);
    check('Speed slider sets valid playback rate', bridge.currentSpeed === 1.5);

    await bridge.setSpeed(10.0);
    check('Excessive speed is clamped to 3.0x', bridge.currentSpeed === 3.0);

    await bridge.setSpeed(0.1);
    check('Sub-minimum speed is clamped to 0.5x', bridge.currentSpeed === 0.5);

    // Check 9: Simulated Native Capacitor Host Integration
    let nativeQueueLoaded = null;
    let nativePlayCalled = false;
    let nativePauseCalled = false;
    let nativeStopCalled = false;
    let nativeSeekTarget = null;
    let nativeSpeedSet = null;

    const mockNativeListeners = {};
    const mockNativePlugin = {
      loadQueue: async (q) => { nativeQueueLoaded = q; },
      play: async () => { nativePlayCalled = true; },
      pause: async () => { nativePauseCalled = true; },
      stop: async () => { nativeStopCalled = true; },
      seek: async (s) => { nativeSeekTarget = s; },
      setSpeed: async (r) => { nativeSpeedSet = r; },
      addListener: (event, handler) => {
        if (!mockNativeListeners[event]) mockNativeListeners[event] = [];
        mockNativeListeners[event].push(handler);
        return () => {};
      }
    };

    // Inject simulated Capacitor platform
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        AxiomPlayback: mockNativePlugin
      }
    };

    const nativeBridge = new PlaybackBridge();
    const isNowNative = await nativeBridge.init();

    check('Bridge correctly detects Capacitor native platform and plugin', isNowNative && nativeBridge.isNative());

    await nativeBridge.loadQueue({
      documentId: 'doc-native',
      title: 'Native Document',
      items: localItems
    });
    check('loadQueue forwards normalized queue to native plugin', nativeQueueLoaded && nativeQueueLoaded.documentId === 'doc-native');

    await nativeBridge.play();
    check('play forwards to native plugin', nativePlayCalled);

    await nativeBridge.pause();
    check('pause forwards to native plugin', nativePauseCalled);

    await nativeBridge.stop();
    check('stop forwards to native plugin', nativeStopCalled);

    await nativeBridge.seek({ sentenceIndex: 1 });
    check('seek forwards to native plugin', nativeSeekTarget && nativeSeekTarget.sentenceIndex === 1);

    await nativeBridge.setSpeed(1.75);
    check('setSpeed forwards to native plugin', nativeSpeedSet && nativeSpeedSet.speed === 1.75);

    // Check 10: Event reflection from Native Service to Web Reader
    let relayedState = null;
    let relayedPosition = null;
    nativeBridge.on('stateChange', evt => { relayedState = evt.state; });
    nativeBridge.on('positionChange', evt => { relayedPosition = evt.index; });

    // Simulate native service sending state change and position progression
    mockNativeListeners['onPlaybackStateChanged'].forEach(h => h({ state: 'playing' }));
    mockNativeListeners['onPositionChanged'].forEach(h => h({ index: 2, blockIdx: 3 }));

    check('Native background service state reflects back to web reader listeners', relayedState === 'playing');
    check('Native background service sentence progression updates web reader position', relayedPosition === 2 && nativeBridge.currentIndex === 2);

    // Cleanup mock Capacitor
    delete window.Capacitor;

  } catch (err) {
    results.push(`FAIL — Unhandled bridge error: ${err.message || err}`);
  }

  if (typeof window.showBridgeResults === 'function') {
    window.showBridgeResults(results);
  } else {
    console.log(results.join('\n'));
  }
})();
