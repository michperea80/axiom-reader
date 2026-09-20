package com.axiom.reader;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.axiom.reader.playback.AxiomMediaPlaybackService;
import com.axiom.reader.playback.AxiomMediaPlaybackService.AxiomQueueItem;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * AxiomPlaybackPlugin — Native bridge between Capacitor web UI and AxiomMediaPlaybackService.
 * Exposes full Phase 0/2 playback contract and dispatches native events to web listeners.
 * 
 * All interactions with the native playback service are dispatched to the Android main looper
 * to guarantee strict thread-safety with ExoPlayer and the Android MediaSession.
 */
@CapacitorPlugin(name = "AxiomPlayback")
public class AxiomPlaybackPlugin extends Plugin implements AxiomMediaPlaybackService.PlaybackEventListener {

    private static final String TAG = "AxiomPlaybackPlugin";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static class PendingQueue {
        String docId;
        String title;
        List<AxiomQueueItem> items;
        int startIndex;
        float speed;
        String playbackOwner;

        PendingQueue(String docId, String title, List<AxiomQueueItem> items, int startIndex, float speed, String playbackOwner) {
            this.docId = docId;
            this.title = title;
            this.items = items;
            this.startIndex = startIndex;
            this.speed = speed;
            this.playbackOwner = playbackOwner;
        }
    }

    private PendingQueue pendingQueue = null;
    private boolean pendingPlay = false;
    // Web-owned queues render audio in the WebView; native-owned queues use Android TTS/Media3.
    private String playbackOwner = "web";

    private final android.content.ServiceConnection serviceConnection = new android.content.ServiceConnection() {
        @Override
        public void onServiceConnected(android.content.ComponentName name, android.os.IBinder binder) {
            Log.i(TAG, "AxiomMediaPlaybackService bound successfully via BIND_AUTO_CREATE");
            AxiomMediaPlaybackService service = AxiomMediaPlaybackService.getInstance();
            if (service != null) {
                service.setEventListener(AxiomPlaybackPlugin.this);
                if (pendingQueue != null) {
                    service.loadQueue(pendingQueue.docId, pendingQueue.title, pendingQueue.items, pendingQueue.startIndex, pendingQueue.speed, pendingQueue.playbackOwner);
                    pendingQueue = null;
                }
                if (pendingPlay && "native".equals(playbackOwner)) {
                    pendingPlay = false;
                    service.play();
                }
            }
        }

        @Override
        public void onServiceDisconnected(android.content.ComponentName name) {
            Log.w(TAG, "AxiomMediaPlaybackService disconnected");
        }
    };

    @Override
    public void load() {
        super.load();
        ensureServiceStarted();
    }

    private void ensureServiceStarted() {
        try {
            android.content.Context context = getContext();
            Intent serviceIntent = new Intent(context, AxiomMediaPlaybackService.class);
            context.bindService(serviceIntent, serviceConnection, android.content.Context.BIND_AUTO_CREATE);
            try {
                context.startService(serviceIntent);
            } catch (Exception ignored) {}

            AxiomMediaPlaybackService service = AxiomMediaPlaybackService.getInstance();
            if (service != null) {
                service.setEventListener(this);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start/bind AxiomMediaPlaybackService: " + e.getMessage(), e);
        }
    }

    private AxiomMediaPlaybackService getService() {
        AxiomMediaPlaybackService service = AxiomMediaPlaybackService.getInstance();
        if (service != null) {
            service.setEventListener(this);
        } else {
            ensureServiceStarted();
        }
        return service;
    }

    @PluginMethod
    public void loadQueue(PluginCall call) {
        JSObject data = call.getData();
        if (data == null || !data.has("items")) {
            call.reject("Missing items in loadQueue payload");
            return;
        }

        try {
            String docId = data.optString("documentId", "unknown");
            String title = data.optString("title", "AXIOM Reader");
            int startIndex = data.optInt("startIndex", 0);
            float speed = (float) data.optDouble("speed", 1.0);
            String requestedOwner = "native".equals(data.optString("playbackOwner", "web")) ? "native" : "web";

            org.json.JSONArray rawItems = data.getJSONArray("items");
            List<AxiomQueueItem> items = new ArrayList<>(rawItems.length());

            for (int i = 0; i < rawItems.length(); i++) {
                JSONObject obj = rawItems.getJSONObject(i);
                int index = obj.optInt("index", i);
                int blockIdx = obj.optInt("blockIdx", i);
                String text = obj.optString("text", "");
                String speechText = obj.optString("speechText", text);
                String audioUri = obj.isNull("audioUri") ? null : obj.optString("audioUri", null);

                items.add(new AxiomQueueItem(index, blockIdx, text, speechText, audioUri));
            }

            mainHandler.post(() -> {
                try {
                    AxiomMediaPlaybackService service = getService();
                    if (service != null) {
                        playbackOwner = requestedOwner;
                        service.loadQueue(docId, title, items, startIndex, speed, requestedOwner);
                        pendingQueue = null;
                        if (pendingPlay && "native".equals(playbackOwner)) {
                            pendingPlay = false;
                            service.play();
                        }
                    } else {
                        // Service is still starting up, retain pending queue
                        playbackOwner = requestedOwner;
                        pendingQueue = new PendingQueue(docId, title, items, startIndex, speed, requestedOwner);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error in loadQueue on main thread: " + e.getMessage(), e);
                }
            });

            JSObject ret = new JSObject();
            ret.put("status", "loaded");
            ret.put("totalItems", items.size());
            call.resolve(ret);

        } catch (JSONException e) {
            Log.e(TAG, "Error parsing queue JSON: " + e.getMessage(), e);
            call.reject("Invalid queue data format: " + e.getMessage());
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null) {
                    if (pendingQueue != null) {
                        service.loadQueue(pendingQueue.docId, pendingQueue.title, pendingQueue.items, pendingQueue.startIndex, pendingQueue.speed, pendingQueue.playbackOwner);
                        pendingQueue = null;
                    }
                    if ("native".equals(playbackOwner)) {
                        service.play();
                    }
                } else {
                    pendingPlay = "native".equals(playbackOwner);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in play on main thread: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        mainHandler.post(() -> {
            try {
                pendingPlay = false;
                AxiomMediaPlaybackService service = getService();
                if (service != null && "native".equals(playbackOwner)) {
                    service.pause();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in pause on main thread: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            try {
                pendingPlay = false;
                AxiomMediaPlaybackService service = getService();
                if (service != null && "native".equals(playbackOwner)) {
                    service.stop();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in stop on main thread: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        JSObject data = call.getData();
        int sentenceIndex = data != null ? data.optInt("sentenceIndex", -1) : -1;
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null && sentenceIndex >= 0 && "native".equals(playbackOwner)) {
                    service.seekToIndex(sentenceIndex);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in seek on main thread: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        JSObject data = call.getData();
        float speed = data != null ? (float) data.optDouble("speed", 1.0) : 1.0f;
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null) {
                    service.setSpeed(speed);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in setSpeed on main thread: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                JSObject ret = new JSObject();
                if (service != null) {
                    ret.put("isPlaying", service.isPlaying());
                    ret.put("currentIndex", service.getCurrentIndex());
                    ret.put("documentId", service.getCurrentDocId());
                    ret.put("title", service.getCurrentTitle());
                } else {
                    ret.put("isPlaying", false);
                    ret.put("currentIndex", 0);
                    ret.put("documentId", "");
                    ret.put("title", "");
                }
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Error in getPlaybackState: " + e.getMessage(), e);
                call.reject("Failed to get playback state: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                JSArray arr = new JSArray();
                if (service != null) {
                    List<Map<String, String>> list = service.getAvailableVoices();
                    for (Map<String, String> v : list) {
                        JSObject obj = new JSObject();
                        obj.put("name", v.get("name"));
                        obj.put("locale", v.get("locale"));
                        obj.put("quality", v.get("quality"));
                        obj.put("network", v.get("network"));
                        arr.put(obj);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("voices", arr);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Error in getVoices: " + e.getMessage(), e);
                call.reject("Failed to get voices: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        JSObject data = call.getData();
        String state = data != null ? data.optString("state", "stopped") : "stopped";
        int index = data != null ? data.optInt("index", -1) : -1;

        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null && "web".equals(playbackOwner)) {
                    service.setExternalPlaybackState(state, index);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in setPlaybackState: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void speakText(PluginCall call) {
        JSObject data = call.getData();
        String text = data != null ? data.optString("text", "This is a voice preview.") : "This is a voice preview.";
        float speed = data != null ? (float) data.optDouble("speed", 1.0) : 1.0f;
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null) {
                    service.speakImmediate(text, speed);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in speakText: " + e.getMessage(), e);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void setVoice(PluginCall call) {
        JSObject data = call.getData();
        String voiceName = data != null ? data.optString("voiceName", null) : null;
        mainHandler.post(() -> {
            try {
                AxiomMediaPlaybackService service = getService();
                if (service != null && voiceName != null) {
                    service.setVoice(voiceName);
                }
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error in setVoice: " + e.getMessage(), e);
                call.reject("Failed to set voice: " + e.getMessage());
            }
        });
    }

    // --- Service Event Listeners dispatching to WebView ---

    @Override
    public void onStateChanged(String state) {
        JSObject event = new JSObject();
        event.put("state", state);
        notifyListeners("onPlaybackStateChanged", event);
    }

    @Override
    public void onPositionChanged(int index, int blockIdx, long offsetMs) {
        JSObject event = new JSObject();
        event.put("index", index);
        event.put("blockIdx", blockIdx);
        event.put("offsetSeconds", offsetMs / 1000.0);
        notifyListeners("onPositionChanged", event);
    }

    @Override
    public void onItemCompleted(int index) {
        JSObject event = new JSObject();
        event.put("index", index);
        notifyListeners("onItemCompleted", event);
    }

    @Override
    public void onQueueEnded() {
        notifyListeners("onQueueEnded", new JSObject());
    }

    @Override
    public void onError(String message) {
        JSObject event = new JSObject();
        event.put("message", message);
        notifyListeners("onError", event);
    }

    @Override
    public void onTransportCommand(String command, int index) {
        JSObject event = new JSObject();
        event.put("command", command);
        event.put("index", index);
        notifyListeners("onTransportCommand", event);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unbindService(serviceConnection);
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }
}
