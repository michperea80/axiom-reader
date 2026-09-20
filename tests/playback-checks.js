(async () => {
  const app = window;
  const results = [];
  function check(name, condition) { results.push(`${condition ? 'PASS' : 'FAIL'} — ${name}`); }
  app.stopTTS();
  const originalRequest = app.requestAdvancedAudio;
  const originalPrefetch = app.prefetchAdvancedAudio;
  const originalSchedule = app.scheduleSpeech;
  const originalMode = localStorage.getItem('axiom-tts-mode');
  try {
    const rangeChecks = (ttsList.map((item, i) => ({ text: speechMatchText(item.text), range: getSpeechRange(i)?.toString() })));
    check('Every sentence, list entry, and table row maps to its displayed text', rangeChecks.every(item => app.speechMatchText(item.range || '') === item.text));
    playing = true; queueToken++; idx = 3;
    app.setFollowAudio(true);
    currentUtterance = app.buildUtterance(ttsList[3], 3, queueToken);
    currentUtterance.onstart();
    check('Local speech start advances sentence highlight', (idx === 3 && CSS.highlights.get("spoken-passage").size === 1));
    app.setFollowAudio(false);
    const scrollBefore = app.document.getElementById('doc-view').scrollTop;
    app.highlightSpeechSentence(rangeChecks.length - 1);
    check('Manual reading disables automatic scrolling', app.document.getElementById('doc-view').scrollTop === scrollBefore);
    app.hideVoiceControls();
    app.setFollowAudio(true);
    app.highlightSpeechSentence(rangeChecks.length - 1, true);
    await new Promise(resolve => setTimeout(resolve, 600));
    const spokenRect = app.getSpeechRange(rangeChecks.length - 1).getClientRects()[0];
    const viewRect = app.document.getElementById('doc-view').getBoundingClientRect();
    check('Resuming following scrolls the spoken text into the reading area', spokenRect.top >= viewRect.top && spokenRect.bottom <= viewRect.bottom);
    const oldToken = (queueToken);
    const oldUtterance = app.buildUtterance((ttsList[0]), 0, oldToken);
    app.stopTTS();
    oldUtterance.onstart();
    check('Cancelled local speech cannot change position', (idx === 3));
    app.document.getElementById('search-input').value = 'passage';
    app.runSearch();
    const afterSearch = (ttsList.every((item,i) => speechMatchText(getSpeechRange(i)?.toString() || "") === speechMatchText(item.text)));
    check('Search markup preserves all narration anchors', afterSearch);
    app.clearSearch();
    check('Classification header is excluded by default', !(ttsList.some(item => item.text.includes("Test fixture"))));
    const originalList = ttsList;
    const originalHeaderPreference = localStorage.getItem('axiom-reader-skip-header');
    try {
      const anchor = { ...originalList[3], occurrence:0 };
      localStorage.setItem('axiom-reader-skip-header', 'off');
      const categories = categorize(currentBlocks);
      buildDoc(currentBlocks, categories.h1Idx, categories.infocardStart, categories.infocardEnd, categories.endMatterIdx);
      check('Changing header reading preserves the saved sentence', ttsList[resolveReadPosition(anchor, 3)].text === originalList[3].text);
    } finally {
      ttsList = originalList;
      if (originalHeaderPreference === null) localStorage.removeItem('axiom-reader-skip-header'); else localStorage.setItem('axiom-reader-skip-header', originalHeaderPreference);
    }
    check('Cloud grouping preserves complete narration order', (createAdvancedChunks().map(chunk=>chunk.speechText).join(" ")) === (ttsList.map(item=>item.speechText).join(" ")));
    const livelySelection = app.parseAdvancedVoiceSelection('en-US-Neural2-F::style=lively');
    check('Lively profile keeps the Google voice ID and speaking style separate', livelySelection.voiceId === 'en-US-Neural2-F' && livelySelection.style === 'lively');
    const defaultKey = app.getAdvancedCacheKey({ engine: 'NEURAL2', voiceId: 'en-US-Neural2-F', speed: 1, text: 'Test.', segments: ['Test.'] });
    const livelyKey = app.getAdvancedCacheKey({ engine: 'NEURAL2', voiceId: 'en-US-Neural2-F', voiceStyle: 'lively', speed: 1, text: 'Test.', segments: ['Test.'] });
    check('Default and Lively recordings use separate saved-audio entries', defaultKey !== livelyKey);
    const timedChunk = app.createAdvancedChunk(0);
    const validTimeline = app.getValidAdvancedTimeline([
      { segmentIndex: 0, timeSeconds: 0 },
      { segmentIndex: 1, timeSeconds: 0.05 },
      { segmentIndex: 999, timeSeconds: 0.08 },
      { segmentIndex: 2, timeSeconds: 99 },
    ], timedChunk, 2);
    check('Cloud timing validation keeps only usable sentence marks', validTimeline.length === 2 && validTimeline[1].sentenceIdx === timedChunk.segmentIndexes[1]);
    // Use a short silent recording to test the real browser audio path without
    // transmitting text or charging a voice provider.
    app.requestAdvancedAudio = async () => btoa('\0'.repeat(48000));
    app.prefetchAdvancedAudio = async () => {};
    app.scheduleSpeech = () => {};
    const voice = app.document.getElementById('voice-sel');
    const previousVoice = voice.value;
    const testVoice = new Option('Gemini test voice', 'gemini-Puck');
    voice.add(testVoice);
    voice.value = 'gemini-Puck';
    localStorage.setItem('axiom-tts-mode', 'proxy');
    app.document.getElementById('rate-slider').value = '1.5';
    playing = true; queueToken++;
    await app.speakAdvanced(app.createAdvancedChunk(0), (queueToken));
    check('Gemini starts real audio with selected speed', (currentAudioSource?.playbackRate.value === 1.5 && isAudioContextSpeaking));
    app.stopTTS();
    check('Stop releases active cloud audio', (currentAudioSource === null && !isAudioContextSpeaking));
    const neuralVoice = new Option('Neural2 timed test voice', 'en-US-Neural2-D');
    voice.add(neuralVoice);
    voice.value = 'en-US-Neural2-D';
    app.document.getElementById('rate-slider').value = '1.2';
    app.setFollowAudio(true);
    const farSentenceIdx = ttsList.length - 2;
    const neuralChunk = {
      startIdx: 0,
      endIdx: farSentenceIdx,
      speechText: `${ttsList[0].speechText} ${ttsList[farSentenceIdx].speechText}`,
      segments: [ttsList[0].speechText, ttsList[farSentenceIdx].speechText],
      segmentIndexes: [0, farSentenceIdx],
    };
    app.requestAdvancedAudio = async () => ({
      data: btoa('\0'.repeat(96000)),
      timings: neuralChunk.segmentIndexes.map((_, segmentIndex) => ({ segmentIndex, timeSeconds: segmentIndex * 0.4 })),
    });
    playing = true; queueToken++;
    await app.speakAdvanced(neuralChunk, queueToken);
    await new Promise(resolve => setTimeout(resolve, 1100));
    check('Neural2 uses Google-generated speed without browser speed distortion', currentAudioSource?.playbackRate.value === 1);
    check('Neural2 timing marks advance the sentence highlight during one recording', idx >= neuralChunk.segmentIndexes[1] && CSS.highlights.get('spoken-passage')?.size === 1);
    const timedRect = app.getSpeechRange(farSentenceIdx).getClientRects()[0];
    const timedViewRect = app.document.getElementById('doc-view').getBoundingClientRect();
    check('Neural2 timing marks automatically scroll below-screen speech into view', timedRect.top >= timedViewRect.top && timedRect.bottom <= timedViewRect.bottom);
    app.stopTTS();
    let rejectPending;
    app.requestAdvancedAudio = () => new Promise((resolve, reject) => { rejectPending = reject; });
    playing = true; queueToken++; idx = 2;
    const pending = app.speakAdvanced(app.createAdvancedChunk(2), (queueToken));
    app.stopTTS();
    rejectPending(new Error('Deliberate cancelled-request test'));
    await pending;
    check('Late cloud failure cannot restart local narration', (currentUtterance === null && !playing));
    testVoice.remove();
    neuralVoice.remove();
    voice.value = previousVoice;
    app.document.getElementById('rate-slider').value = '1';
    app.setFollowAudio(true);
  } catch (error) { results.push('FAIL — ' + error.stack); }
  finally {
    if (originalMode === null) localStorage.removeItem('axiom-tts-mode'); else localStorage.setItem('axiom-tts-mode', originalMode);
    app.stopTTS();
    app.requestAdvancedAudio = originalRequest;
    app.prefetchAdvancedAudio = originalPrefetch;
    app.scheduleSpeech = originalSchedule;
  }

  parent.showReaderResults(results);
})();
