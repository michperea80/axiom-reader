package com.axiom.reader.playback;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.content.Context;
import android.media.AudioFocusRequest;
import android.media.AudioManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;

import com.axiom.reader.MainActivity;
import com.axiom.reader.R;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * AxiomMediaPlaybackService
 * 
 * Android Media3 MediaLibraryService providing durable screen-off background playback,
 * lock-screen and notification media controls, Wear OS / Pixel Watch controls,
 * Android Auto vehicle browsing, and unified audio playback for both local TTS and cloud audio.
 */
public class AxiomMediaPlaybackService extends MediaLibraryService {

    private static final String TAG = "AxiomPlaybackService";
    private static final String CHANNEL_ID = "axiom_playback_channel";
    private static AxiomMediaPlaybackService instance = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock = null;

    private ExoPlayer player;
    private ForwardingPlayer forwardingPlayer;
    private MediaLibrarySession mediaLibrarySession;
    private TextToSpeech tts;
    private boolean isTtsReady = false;
    private boolean pendingPlayAfterTtsInit = false;
    private Voice defaultTtsVoice = null;
    private long utteranceGeneration = 0;
    private String activeUtteranceId = null;

    // Playback state
    private boolean isPlaying = false;
    private String currentDocId = "unknown";
    private String currentTitle = "AXIOM Reader";
    private final List<AxiomQueueItem> queueItems = new ArrayList<>();
    private int currentIndex = 0;
    private float currentSpeed = 1.0f;
    private File silenceWavFile = null;
    private MediaMetadata currentMediaMetadata = MediaMetadata.EMPTY;
    private MediaItem currentMediaItem = null;
    // "web" means the WebView owns audible playback; "native" means this service does.
    private String playbackOwner = "web";
    private AudioManager audioManager = null;
    private AudioFocusRequest audioFocusRequest = null;
    private boolean hasAudioFocus = false;

    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = focusChange -> {
        Log.d(TAG, "Audio focus changed: " + focusChange);
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            hasAudioFocus = false;
            if (isPlaying) {
                dispatchTransportPlay(false);
            }
        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            hasAudioFocus = true;
        }
    };

    private Uri getAppIconUri() {
        return Uri.parse("android.resource://" + getPackageName() + "/" + R.drawable.app_icon);
    }

    private synchronized boolean requestAudioFocus() {
        if (hasAudioFocus) return true;
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null) return false;

        int res;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.media.AudioAttributes playbackAttributes = new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
                    .build();
            res = audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            res = audioManager.requestAudioFocus(
                    audioFocusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            );
        }

        hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        Log.d(TAG, "requestAudioFocus result: " + res + " (granted=" + hasAudioFocus + ")");
        return hasAudioFocus;
    }

    private synchronized void abandonAudioFocus() {
        if (!hasAudioFocus) return;
        if (audioManager == null) return;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(audioFocusChangeListener);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to abandon audio focus: " + e.getMessage());
        }
        hasAudioFocus = false;
        Log.d(TAG, "abandonAudioFocus completed");
    }

    public interface PlaybackEventListener {
        void onStateChanged(String state);
        void onPositionChanged(int index, int blockIdx, long offsetMs);
        void onItemCompleted(int index);
        void onQueueEnded();
        void onError(String message);
        void onTransportCommand(String command, int index);
    }

    private PlaybackEventListener eventListener = null;

    public static class AxiomQueueItem {
        public int index;
        public int blockIdx;
        public String text;
        public String speechText;
        public String audioUri;

        public AxiomQueueItem(int index, int blockIdx, String text, String speechText, String audioUri) {
            this.index = index;
            this.blockIdx = blockIdx;
            this.text = text;
            this.speechText = speechText;
            this.audioUri = audioUri;
        }
    }

    public static AxiomMediaPlaybackService getInstance() {
        return instance;
    }

    public void setEventListener(PlaybackEventListener listener) {
        this.eventListener = listener;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.i(TAG, "Creating AxiomMediaPlaybackService...");

        initWakeLock();
        initPlayer();
        initForwardingPlayer();
        initMediaSession();
        initNotificationProvider();
        initTextToSpeech();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        return START_STICKY;
    }

    private void initWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AxiomReader:PlaybackWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize WakeLock: " + e.getMessage());
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(12 * 60 * 60 * 1000L); // 12 hours safety maximum
                Log.d(TAG, "Acquired PARTIAL_WAKE_LOCK for screen-off playback");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WakeLock: " + e.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "Released PARTIAL_WAKE_LOCK");
            }
        } catch (Exception ignored) {}
    }

    private void initNotificationProvider() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.playback_channel_name),
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Audio playback and lock screen controls");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }

        // Use dedicated monochrome vector small icon to prevent BadForegroundServiceNotificationException
        DefaultMediaNotificationProvider notificationProvider = new DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.playback_channel_name)
                .build();
        notificationProvider.setSmallIcon(R.drawable.ic_notification);
        setMediaNotificationProvider(notificationProvider);
    }

    private void initPlayer() {
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .setUsage(C.USAGE_MEDIA)
                .build();

        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, false /* handleAudioFocus false to avoid competing with service AudioManager focus */)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    if (isPlaying && currentIndex >= 0 && currentIndex < queueItems.size()) {
                        AxiomQueueItem item = queueItems.get(currentIndex);
                        if (item.audioUri != null && !item.audioUri.isEmpty()) {
                            // Cloud audio item completed! Auto-advance
                            if (eventListener != null) eventListener.onItemCompleted(currentIndex);
                            currentIndex++;
                            if (currentIndex < queueItems.size()) {
                                speakCurrentSentence();
                            } else {
                                stop();
                                if (eventListener != null) eventListener.onQueueEnded();
                            }
                        }
                    }
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                Log.e(TAG, "Player error: " + error.getMessage(), error);
                if (eventListener != null) {
                    eventListener.onError("Playback error: " + error.getMessage());
                }
            }
        });
    }

    private void initForwardingPlayer() {
        forwardingPlayer = new ForwardingPlayer(player) {
            @Override
            public void play() {
                dispatchTransportPlay(true);
            }

            @Override
            public void pause() {
                dispatchTransportPlay(false);
            }

            @Override
            public void setPlayWhenReady(boolean playWhenReady) {
                dispatchTransportPlay(playWhenReady);
            }

            @Override
            public void stop() {
                notifyTransportCommand("stop", currentIndex);
            }

            @Override
            public void seekToNext() {
                dispatchTransportSeek(currentIndex + 1);
            }

            @Override
            public void seekToPrevious() {
                dispatchTransportSeek(currentIndex - 1);
            }

            @Override
            public void seekToNextMediaItem() {
                dispatchTransportSeek(currentIndex + 1);
            }

            @Override
            public void seekToPreviousMediaItem() {
                dispatchTransportSeek(currentIndex - 1);
            }

            @Override
            public boolean isPlaying() {
                return AxiomMediaPlaybackService.this.isPlaying;
            }

            @Override
            public int getPlaybackState() {
                if (queueItems.isEmpty() && currentMediaItem == null) {
                    return Player.STATE_IDLE;
                }
                return Player.STATE_READY;
            }

            @Override
            public boolean getPlayWhenReady() {
                return AxiomMediaPlaybackService.this.isPlaying;
            }

            @NonNull
            @Override
            public MediaMetadata getMediaMetadata() {
                if (currentMediaMetadata != null && currentMediaMetadata.title != null) {
                    return currentMediaMetadata;
                }
                return super.getMediaMetadata();
            }

            @NonNull
            @Override
            public MediaMetadata getPlaylistMetadata() {
                if (currentMediaMetadata != null && currentMediaMetadata.title != null) {
                    return currentMediaMetadata;
                }
                return super.getPlaylistMetadata();
            }

            @NonNull
            @Override
            public Player.Commands getAvailableCommands() {
                return new Player.Commands.Builder()
                        .addAll(super.getAvailableCommands())
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .add(Player.COMMAND_STOP)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == Player.COMMAND_PLAY_PAUSE ||
                    command == Player.COMMAND_SEEK_TO_NEXT ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS ||
                    command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ||
                    command == Player.COMMAND_STOP) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }
        };
    }

    private void dispatchTransportPlay(boolean shouldPlay) {
        // Controllers (watch, lock screen, headset) always route through the WebView.
        // It owns reader UI state and invokes the appropriate native action for native queues.
        notifyTransportCommand(shouldPlay ? "play" : "pause", currentIndex);
    }

    private void dispatchTransportSeek(int requestedIndex) {
        if (queueItems.isEmpty()) return;
        int targetIndex = Math.max(0, Math.min(queueItems.size() - 1, requestedIndex));
        notifyTransportCommand("seek", targetIndex);
    }

    private void notifyTransportCommand(String command, int index) {
        if (eventListener != null) {
            eventListener.onTransportCommand(command, index);
        }
    }

    private void initMediaSession() {
        Intent sessionIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                sessionIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        MediaLibrarySession.Callback sessionCallback = new MediaLibrarySession.Callback() {
            @NonNull
            @Override
            public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
                    @NonNull MediaLibrarySession session,
                    @NonNull MediaSession.ControllerInfo browser,
                    @NonNull String parentId,
                    int page,
                    int pageSize,
                    @Nullable LibraryParams params) {

                List<MediaItem> children = new ArrayList<>();

                if ("root".equals(parentId)) {
                    MediaItem recentsCategory = new MediaItem.Builder()
                            .setMediaId("recents")
                            .setMediaMetadata(new MediaMetadata.Builder()
                                    .setTitle("Current Document")
                                    .setSubtitle(currentTitle)
                                    .setArtworkUri(getAppIconUri())
                                    .setIsPlayable(false)
                                    .setIsBrowsable(true)
                                    .build())
                            .build();

                    MediaItem passagesCategory = new MediaItem.Builder()
                            .setMediaId("passages")
                            .setMediaMetadata(new MediaMetadata.Builder()
                                    .setTitle("Passages & Sentences")
                                    .setSubtitle(queueItems.size() + " passages available")
                                    .setArtworkUri(getAppIconUri())
                                    .setIsPlayable(false)
                                    .setIsBrowsable(true)
                                    .build())
                            .build();

                    children.add(recentsCategory);
                    children.add(passagesCategory);
                    return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params));

                } else if ("recents".equals(parentId)) {
                    String posDesc = queueItems.isEmpty() ? "No document active" : "Sentence " + (currentIndex + 1) + " of " + queueItems.size();
                    MediaItem activeDoc = new MediaItem.Builder()
                            .setMediaId("doc_" + currentDocId)
                            .setMediaMetadata(new MediaMetadata.Builder()
                                    .setTitle(currentTitle)
                                    .setSubtitle(posDesc)
                                    .setArtworkUri(getAppIconUri())
                                    .setIsPlayable(true)
                                    .setIsBrowsable(false)
                                    .build())
                            .build();
                    children.add(activeDoc);
                    return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params));

                } else if ("passages".equals(parentId)) {
                    int start = Math.max(0, page * pageSize);
                    int end = Math.min(queueItems.size(), start + (pageSize > 0 ? pageSize : 50));

                    for (int i = start; i < end; i++) {
                        AxiomQueueItem item = queueItems.get(i);
                        String preview = item.text.length() > 60 ? item.text.substring(0, 57) + "..." : item.text;
                        MediaItem passageItem = new MediaItem.Builder()
                                .setMediaId("passage_" + item.index)
                                .setMediaMetadata(new MediaMetadata.Builder()
                                        .setTitle((item.index + 1) + ". " + preview)
                                        .setSubtitle(currentTitle)
                                        .setArtworkUri(getAppIconUri())
                                        .setIsPlayable(true)
                                        .setIsBrowsable(false)
                                        .build())
                                .build();
                        children.add(passageItem);
                    }
                    return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params));
                }

                return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.of(), params));
            }

            @NonNull
            @Override
            public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
                    @NonNull MediaLibrarySession session,
                    @NonNull MediaSession.ControllerInfo browser,
                    @Nullable LibraryParams params) {
                MediaItem rootItem = new MediaItem.Builder()
                        .setMediaId("root")
                        .setMediaMetadata(new MediaMetadata.Builder()
                                .setTitle("AXIOM Reader")
                                .setArtworkUri(getAppIconUri())
                                .setIsPlayable(false)
                                .setIsBrowsable(true)
                                .build())
                        .build();
                return Futures.immediateFuture(LibraryResult.ofItem(rootItem, params));
            }

            @NonNull
            @Override
            public ListenableFuture<LibraryResult<MediaItem>> onGetItem(
                    @NonNull MediaLibrarySession session,
                    @NonNull MediaSession.ControllerInfo browser,
                    @NonNull String mediaId) {
                if (mediaId.startsWith("doc_")) {
                    MediaItem docItem = new MediaItem.Builder()
                            .setMediaId(mediaId)
                            .setMediaMetadata(new MediaMetadata.Builder()
                                    .setTitle(currentTitle)
                                    .setSubtitle("Sentence " + (currentIndex + 1) + " of " + queueItems.size())
                                    .setArtworkUri(getAppIconUri())
                                    .setIsPlayable(true)
                                    .setIsBrowsable(false)
                                    .build())
                            .build();
                    return Futures.immediateFuture(LibraryResult.ofItem(docItem, null));
                }
                return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
            }

            @NonNull
            @Override
            public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
                    @NonNull MediaSession session,
                    @NonNull MediaSession.ControllerInfo controller,
                    @NonNull List<MediaItem> mediaItems,
                    int startIndex,
                    long startPositionMs) {

                if (!mediaItems.isEmpty()) {
                    String selectedId = mediaItems.get(0).mediaId;
                    if (selectedId != null) {
                        if (selectedId.startsWith("passage_")) {
                            try {
                                int passageIdx = Integer.parseInt(selectedId.substring("passage_".length()));
                                seekToIndex(passageIdx);
                            } catch (NumberFormatException ignored) {}
                        } else if (selectedId.startsWith("doc_")) {
                            play();
                        }
                    }
                }
                return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs));
            }

            @NonNull
            @Override
            public ListenableFuture<SessionResult> onCustomCommand(
                    @NonNull MediaSession session,
                    @NonNull MediaSession.ControllerInfo controller,
                    @NonNull SessionCommand customCommand,
                    @NonNull Bundle args) {
                return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
            }
        };

        mediaLibrarySession = new MediaLibrarySession.Builder(this, forwardingPlayer, sessionCallback)
                .setSessionActivity(pendingIntent)
                .setId("AxiomMediaSession")
                .build();
        addSession(mediaLibrarySession);
    }

    private void initTextToSpeech() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                isTtsReady = true;
                defaultTtsVoice = tts.getVoice();
                int langResult = tts.setLanguage(Locale.getDefault());
                if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.US);
                }

                // Set USAGE_MEDIA so Samsung and Android audio router treats speech as primary media
                try {
                    android.media.AudioAttributes ttsAttrs = new android.media.AudioAttributes.Builder()
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                            .build();
                    tts.setAudioAttributes(ttsAttrs);
                } catch (Exception e) {
                    Log.w(TAG, "Failed to set TTS AudioAttributes: " + e.getMessage());
                }

                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        Log.i(TAG, "TTS utterance onStart: " + utteranceId);
                        if ("preview_utt".equals(utteranceId)) return;
                        mainHandler.post(() -> {
                            if (!isPlaying || !utteranceId.equals(activeUtteranceId)) return;
                            if (currentIndex >= 0 && currentIndex < queueItems.size()) {
                                AxiomQueueItem item = queueItems.get(currentIndex);
                                if (eventListener != null) {
                                    eventListener.onPositionChanged(currentIndex, item.blockIdx, 0);
                                }
                            }
                        });
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        Log.i(TAG, "TTS utterance onDone: " + utteranceId);
                        if ("preview_utt".equals(utteranceId)) return;
                        mainHandler.post(() -> {
                            if (!isPlaying) return;
                            // Only advance if callback matches the active sentence utterance to prevent stale skips
                            if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                                if (eventListener != null) {
                                    eventListener.onItemCompleted(currentIndex);
                                }
                                currentIndex++;
                                if (currentIndex < queueItems.size()) {
                                    speakCurrentSentence();
                                } else {
                                    stop();
                                    if (eventListener != null) {
                                        eventListener.onQueueEnded();
                                    }
                                }
                            }
                        });
                    }

                    @Override
                    public void onError(String utteranceId) {
                        Log.e(TAG, "TTS utterance onError: " + utteranceId);
                        if ("preview_utt".equals(utteranceId)) return;
                        handleTtsError(utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        Log.e(TAG, "TTS utterance error: " + utteranceId + ", code: " + errorCode);
                        if ("preview_utt".equals(utteranceId)) return;
                        handleTtsError(utteranceId);
                    }

                    private void handleTtsError(String utteranceId) {
                        mainHandler.post(() -> {
                            if (!isPlaying) return;
                            if (utteranceId != null && utteranceId.equals(activeUtteranceId)) {
                                currentIndex++;
                                if (currentIndex < queueItems.size()) {
                                    speakCurrentSentence();
                                } else {
                                    stop();
                                }
                            }
                        });
                    }
                });

                Log.i(TAG, "Android TextToSpeech initialized successfully with USAGE_MEDIA");
                if (pendingPlayAfterTtsInit) {
                    pendingPlayAfterTtsInit = false;
                    play();
                }
            } else {
                Log.w(TAG, "Android TextToSpeech failed to initialize: status " + status);
            }
        });
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return mediaLibrarySession;
    }

    // --- Audio Pipeline & Queue Control APIs ---

    private synchronized File getOrCreateSilenceWav() {
        if (silenceWavFile != null && silenceWavFile.exists() && silenceWavFile.length() > 0) {
            return silenceWavFile;
        }

        File cacheDir = new File(getCacheDir(), "axiom_audio");
        if (!cacheDir.exists()) cacheDir.mkdirs();
        silenceWavFile = new File(cacheDir, "silence.wav");
        if (silenceWavFile.exists() && silenceWavFile.length() > 0) {
            return silenceWavFile;
        }

        int sampleRate = 16000;
        int numSamples = sampleRate; // 1 second
        int dataSize = numSamples * 2; // 16-bit mono
        byte[] wav = new byte[44 + dataSize];

        wav[0] = 'R'; wav[1] = 'I'; wav[2] = 'F'; wav[3] = 'F';
        int chunkSize = 36 + dataSize;
        wav[4] = (byte)(chunkSize & 0xff);
        wav[5] = (byte)((chunkSize >> 8) & 0xff);
        wav[6] = (byte)((chunkSize >> 16) & 0xff);
        wav[7] = (byte)((chunkSize >> 24) & 0xff);
        wav[8] = 'W'; wav[9] = 'A'; wav[10] = 'V'; wav[11] = 'E';

        wav[12] = 'f'; wav[13] = 'm'; wav[14] = 't'; wav[15] = ' ';
        wav[16] = 16; wav[17] = 0; wav[18] = 0; wav[19] = 0;
        wav[20] = 1; wav[21] = 0; // PCM
        wav[22] = 1; wav[23] = 0; // Mono
        wav[24] = (byte)(sampleRate & 0xff);
        wav[25] = (byte)((sampleRate >> 8) & 0xff);
        wav[26] = (byte)((sampleRate >> 16) & 0xff);
        wav[27] = (byte)((sampleRate >> 24) & 0xff);
        int byteRate = sampleRate * 2;
        wav[28] = (byte)(byteRate & 0xff);
        wav[29] = (byte)((byteRate >> 8) & 0xff);
        wav[30] = (byte)((byteRate >> 16) & 0xff);
        wav[31] = (byte)((byteRate >> 24) & 0xff);
        wav[32] = 2; wav[33] = 0;
        wav[34] = 16; wav[35] = 0;

        wav[36] = 'd'; wav[37] = 'a'; wav[38] = 't'; wav[39] = 'a';
        wav[40] = (byte)(dataSize & 0xff);
        wav[41] = (byte)((dataSize >> 8) & 0xff);
        wav[42] = (byte)((dataSize >> 16) & 0xff);
        wav[43] = (byte)((dataSize >> 24) & 0xff);

        try (FileOutputStream fos = new FileOutputStream(silenceWavFile)) {
            fos.write(wav);
        } catch (IOException e) {
            Log.e(TAG, "Failed to write silence.wav: " + e.getMessage(), e);
        }
        return silenceWavFile;
    }

    private void ensureSilencePlaying() {
        requestAudioFocus();
        if (player != null && !player.isPlaying()) {
            File silence = getOrCreateSilenceWav();
            if (silence.exists()) {
                player.setRepeatMode(Player.REPEAT_MODE_ALL);
                MediaItem.Builder silenceBuilder = new MediaItem.Builder()
                        .setUri(Uri.fromFile(silence))
                        .setMediaId("silence_track");
                if (currentMediaMetadata != null && currentMediaMetadata.title != null) {
                    silenceBuilder.setMediaMetadata(currentMediaMetadata);
                }
                MediaItem silenceItem = silenceBuilder.build();
                player.setMediaItem(silenceItem);
                player.prepare();
                player.play();
                Log.d(TAG, "Started background silence audio loop");
            }
        }
    }

    public synchronized void loadQueue(String docId, String title, List<AxiomQueueItem> items, int startIndex, float speed, String playbackOwner) {
        this.currentDocId = docId;
        this.currentTitle = title;
        this.queueItems.clear();
        this.queueItems.addAll(items);
        this.currentIndex = Math.max(0, Math.min(items.size() - 1, startIndex));
        this.currentSpeed = Math.max(0.5f, Math.min(3.0f, speed));
        this.playbackOwner = "native".equals(playbackOwner) ? "native" : "web";
        pendingPlayAfterTtsInit = false;
        invalidateActiveUtterance();

        if (player != null) {
            player.stop();
            player.clearMediaItems();
            player.setPlaybackParameters(new PlaybackParameters(this.currentSpeed));
        }

        if (currentIndex < queueItems.size()) {
            updateMetadataForCurrentItem(queueItems.get(currentIndex));
        }
    }

    private void updateMetadataForCurrentItem(AxiomQueueItem item) {
        if (mediaLibrarySession == null) return;
        try {
            String passage = (item != null && item.text != null) ? item.text : "";
            if (passage.length() > 90) passage = passage.substring(0, 87) + "...";
            String positionDesc = queueItems.isEmpty() ? "" : "Sentence " + (currentIndex + 1) + " of " + queueItems.size();

            currentMediaMetadata = new MediaMetadata.Builder()
                    .setTitle(currentTitle != null ? currentTitle : "AXIOM Reader")
                    .setArtist(passage.isEmpty() ? "AXIOM // Reader" : passage)
                    .setAlbumTitle(positionDesc)
                    .setDisplayTitle(currentTitle != null ? currentTitle : "AXIOM Reader")
                    .setSubtitle(passage)
                    .setDescription(positionDesc)
                    .setArtworkUri(getAppIconUri())
                    .build();

            currentMediaItem = new MediaItem.Builder()
                    .setMediaId("passage_" + currentIndex)
                    .setMediaMetadata(currentMediaMetadata)
                    .build();

            if (player != null) {
                player.setPlaylistMetadata(currentMediaMetadata);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to update playlist metadata: " + e.getMessage());
        }
    }

    private void speakCurrentSentence() {
        if (currentIndex < 0 || currentIndex >= queueItems.size()) {
            stop();
            if (eventListener != null) eventListener.onQueueEnded();
            return;
        }

        AxiomQueueItem item = queueItems.get(currentIndex);
        updateMetadataForCurrentItem(item);

        if (item.audioUri != null && !item.audioUri.isEmpty()) {
            // Cloud audio URI: pause local TTS and let ExoPlayer play the audio chunk
            if (tts != null) {
                invalidateActiveUtterance();
                tts.stop();
            }
            player.setRepeatMode(Player.REPEAT_MODE_OFF);
            MediaItem cloudItem = new MediaItem.Builder()
                    .setUri(Uri.parse(item.audioUri))
                    .setMediaId("cloud_" + item.index)
                    .setMediaMetadata(currentMediaMetadata)
                    .build();
            player.setMediaItem(cloudItem);
            player.prepare();
            player.play();
            if (eventListener != null) {
                eventListener.onPositionChanged(currentIndex, item.blockIdx, 0);
            }
        } else {
            // Local TTS speech
            if (!isTtsReady || tts == null) {
                pendingPlayAfterTtsInit = true;
                Log.w(TAG, "Local TTS not ready yet, pending play");
                return;
            }

            // Keep ExoPlayer silence AudioTrack active so MediaSession / Wear OS / Android Auto stays in playing state
            ensureSilencePlaying();

            tts.setSpeechRate(currentSpeed);
            Bundle params = new Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_STREAM, String.valueOf(android.media.AudioManager.STREAM_MUSIC));
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            final String utteranceId = "utt_" + (++utteranceGeneration) + "_" + item.index;
            activeUtteranceId = utteranceId;
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
            String textToSpeak = (item.speechText != null && !item.speechText.isEmpty()) ? item.speechText : item.text;
            int result = tts.speak(textToSpeak, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            Log.i(TAG, "tts.speak sentence " + currentIndex + " (length " + textToSpeak.length() + "), result: " + result);
            if (result != TextToSpeech.SUCCESS) {
                Log.w(TAG, "tts.speak returned non-success code: " + result + ", retrying in 300ms");
                mainHandler.postDelayed(() -> {
                    if (isPlaying && utteranceId.equals(activeUtteranceId)) {
                        currentIndex++;
                        if (currentIndex < queueItems.size()) {
                            speakCurrentSentence();
                        } else {
                            stop();
                        }
                    }
                }, 300);
            }
        }
    }

    public synchronized void speakImmediate(String text, float speed) {
        if (tts != null && isTtsReady) {
            invalidateActiveUtterance();
            if (player != null && player.isPlaying()) {
                player.pause();
            }
            tts.setSpeechRate(Math.max(0.5f, Math.min(3.0f, speed)));
            Bundle params = new Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_STREAM, String.valueOf(android.media.AudioManager.STREAM_MUSIC));
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "preview_utt");
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "preview_utt");
            Log.i(TAG, "speakImmediate result: " + result + ", text: " + text);
        } else {
            Log.w(TAG, "speakImmediate: TTS not ready or null");
        }
    }

    public synchronized void play() {
        if (isPlaying) return;
        isPlaying = true;
        acquireWakeLock();
        requestAudioFocus();
        speakCurrentSentence();
        if (eventListener != null) {
            eventListener.onStateChanged("playing");
        }
    }

    public synchronized void pause() {
        isPlaying = false;
        pendingPlayAfterTtsInit = false;
        invalidateActiveUtterance();
        releaseWakeLock();
        if (tts != null) tts.stop();
        if (player != null) player.pause();
        if (eventListener != null) {
            eventListener.onStateChanged("paused");
        }
    }

    public synchronized void stop() {
        isPlaying = false;
        pendingPlayAfterTtsInit = false;
        invalidateActiveUtterance();
        releaseWakeLock();
        abandonAudioFocus();
        if (tts != null) tts.stop();
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        if (eventListener != null) {
            eventListener.onStateChanged("stopped");
        }
    }

    public synchronized void setExternalPlaybackState(String state, int index) {
        if (index >= 0 && index < queueItems.size()) {
            this.currentIndex = index;
            updateMetadataForCurrentItem(queueItems.get(index));
        }

        if ("playing".equals(state)) {
            this.isPlaying = true;
            acquireWakeLock();
            requestAudioFocus();
            ensureSilencePlaying();
        } else if ("paused".equals(state) || "stopped".equals(state)) {
            this.isPlaying = false;
            releaseWakeLock();
            if (player != null && player.isPlaying()) {
                player.pause();
            }
            if (tts != null) {
                tts.stop();
            }
            if ("stopped".equals(state)) {
                abandonAudioFocus();
            }
        }
    }

    public synchronized void seekToIndex(int newIndex) {
        if (queueItems.isEmpty()) return;
        currentIndex = Math.max(0, Math.min(queueItems.size() - 1, newIndex));
        AxiomQueueItem item = queueItems.get(currentIndex);
        updateMetadataForCurrentItem(item);

        if (eventListener != null) {
            eventListener.onPositionChanged(currentIndex, item.blockIdx, 0);
        }

        if (isPlaying) {
            speakCurrentSentence();
        }
    }

    public synchronized void setSpeed(float speed) {
        this.currentSpeed = Math.max(0.5f, Math.min(3.0f, speed));
        if (tts != null) {
            tts.setSpeechRate(this.currentSpeed);
        }
        if (player != null) {
            player.setPlaybackParameters(new PlaybackParameters(this.currentSpeed));
        }
    }

    public int getCurrentIndex() {
        return currentIndex;
    }

    public boolean isPlaying() {
        return isPlaying;
    }

    public List<Map<String, String>> getAvailableVoices() {
        List<Map<String, String>> list = new ArrayList<>();
        if (tts != null) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getLocale() != null && v.getLocale().getLanguage().startsWith("en")) {
                            Map<String, String> m = new HashMap<>();
                            m.put("name", v.getName());
                            m.put("locale", v.getLocale().toString());
                            m.put("quality", String.valueOf(v.getQuality()));
                            m.put("network", String.valueOf(v.isNetworkConnectionRequired()));
                            list.add(m);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Error fetching TTS voices: " + e.getMessage());
            }
        }
        return list;
    }

    public void setVoice(String voiceName) {
        if (tts != null && voiceName != null && !voiceName.isEmpty()) {
            try {
                if ("system".equals(voiceName)) {
                    if (defaultTtsVoice != null) {
                        tts.setVoice(defaultTtsVoice);
                        Log.i(TAG, "Restored system default native TTS voice");
                    }
                    return;
                }
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getName().equals(voiceName)) {
                            tts.setVoice(v);
                            Log.i(TAG, "Switched native TTS voice to: " + voiceName);
                            break;
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to set voice: " + e.getMessage());
            }
        }
    }

    private void invalidateActiveUtterance() {
        utteranceGeneration++;
        activeUtteranceId = null;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Destroying AxiomMediaPlaybackService...");
        isPlaying = false;
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaLibrarySession != null) {
            removeSession(mediaLibrarySession);
            mediaLibrarySession.release();
            mediaLibrarySession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        instance = null;
        super.onDestroy();
    }
}
