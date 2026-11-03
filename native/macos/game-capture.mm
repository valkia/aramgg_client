// Node-API keeps this module independent of Electron's Node/V8 ABI.
#include <node_api.h>
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <ImageIO/ImageIO.h>
#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {
struct Result {
    std::mutex mutex;
    std::string error;
    std::string title;
    std::vector<uint8_t> png;
    CGRect bounds = CGRectZero;
    uint32_t windowID = 0;
    int layer = 0;
    bool onScreen = false;
    size_t width = 0, height = 0;
};
struct Work {
    napi_deferred deferred;
    napi_async_work async;
    int width = 0, height = 0, timeoutMs = 2500;
    std::shared_ptr<Result> result = std::make_shared<Result>();
};

void SetString(napi_env env, napi_value object, const char* key, const std::string& value) {
    napi_value js;
    napi_create_string_utf8(env, value.c_str(), value.size(), &js);
    napi_set_named_property(env, object, key, js);
}
void SetNumber(napi_env env, napi_value object, const char* key, double value) {
    napi_value js;
    napi_create_double(env, value, &js);
    napi_set_named_property(env, object, key, js);
}
void SetBoolean(napi_env env, napi_value object, const char* key, bool value) {
    napi_value js;
    napi_get_boolean(env, value, &js);
    napi_set_named_property(env, object, key, js);
}

void ExecuteCapture(napi_env, void* data) {
    Work* work = static_cast<Work*>(data);
    // Completion blocks may outlive our timeout; their shared result stays alive.
    const auto result = work->result;
    const int requestedWidth = work->width, requestedHeight = work->height;
    @autoreleasepool {
        if (@available(macOS 14.0, *)) {
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                onScreenWindowsOnly:NO completionHandler:^(SCShareableContent* content, NSError* error) {
                @autoreleasepool {
                    if (error) {
                        std::lock_guard<std::mutex> lock(result->mutex);
                        result->error = "shareable-content: " + std::string(error.localizedDescription.UTF8String);
                        dispatch_semaphore_signal(done);
                        return;
                    }
                    SCWindow* game = nil;
                    CGFloat bestArea = 0;
                    for (SCWindow* window in content.windows) {
                        // Match the game process, never the launcher or a similarly titled page.
                        if (![window.owningApplication.bundleIdentifier
                            isEqualToString:@"com.riotgames.LeagueofLegends.GameClient"]) continue;
                        if (window.frame.size.width < 200 || window.frame.size.height < 120) continue;
                        const CGFloat area = window.frame.size.width * window.frame.size.height;
                        if (area > bestArea) { game = window; bestArea = area; }
                    }
                    if (!game) {
                        std::lock_guard<std::mutex> lock(result->mutex);
                        result->error = "game-window-not-found";
                        dispatch_semaphore_signal(done);
                        return;
                    }
                    {
                        std::lock_guard<std::mutex> lock(result->mutex);
                        result->windowID = game.windowID;
                        result->title = game.title.UTF8String ?: "League of Legends";
                        result->bounds = game.frame;
                        result->layer = (int)game.windowLayer;
                        result->onScreen = game.onScreen;
                    }
                    if (!requestedWidth || !requestedHeight) {
                        dispatch_semaphore_signal(done);
                        return;
                    }
                    SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:game];
                    const CGRect rect = filter.contentRect;
                    if (!std::isfinite(rect.size.width) || !std::isfinite(rect.size.height) ||
                        rect.size.width <= 0 || rect.size.height <= 0) {
                        std::lock_guard<std::mutex> lock(result->mutex);
                        result->error = "invalid-game-content-size";
                        dispatch_semaphore_signal(done);
                        return;
                    }
                    const double scale = std::min(requestedWidth / rect.size.width,
                        requestedHeight / rect.size.height);
                    SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
                    config.width = std::max(1, (int)std::lround(rect.size.width * scale));
                    config.height = std::max(1, (int)std::lround(rect.size.height * scale));
                    config.showsCursor = NO;
                    config.capturesAudio = NO;
                    config.ignoreShadowsSingleWindow = YES;
                    config.ignoreGlobalClipSingleWindow = YES;
                    [SCScreenshotManager captureImageWithFilter:filter configuration:config
                        completionHandler:^(CGImageRef image, NSError* captureError) {
                        @autoreleasepool {
                            std::lock_guard<std::mutex> lock(result->mutex);
                            if (captureError || !image) {
                                result->error = "capture: " + std::string(captureError.localizedDescription.UTF8String ?: "empty image");
                            } else {
                                NSMutableData* bytes = [NSMutableData data];
                                CGImageDestinationRef destination = CGImageDestinationCreateWithData(
                                    (__bridge CFMutableDataRef)bytes, CFSTR("public.png"), 1, nullptr);
                                if (destination) {
                                    CGImageDestinationAddImage(destination, image, nullptr);
                                    if (CGImageDestinationFinalize(destination)) {
                                        const auto* start = static_cast<const uint8_t*>(bytes.bytes);
                                        result->png.assign(start, start + bytes.length);
                                        result->width = CGImageGetWidth(image);
                                        result->height = CGImageGetHeight(image);
                                    } else result->error = "png-encoding-failed";
                                    CFRelease(destination);
                                } else result->error = "png-destination-failed";
                            }
                            dispatch_semaphore_signal(done);
                        }
                    }];
                }
            }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW,
                work->timeoutMs * NSEC_PER_MSEC)) != 0) {
                std::lock_guard<std::mutex> lock(result->mutex);
                result->error = "capture-timeout";
            }
        } else {
            result->error = "macOS-14-required";
        }
    }
}

void CompleteCapture(napi_env env, napi_status status, void* data) {
    std::unique_ptr<Work> work(static_cast<Work*>(data));
    std::lock_guard<std::mutex> lock(work->result->mutex);
    const auto& result = *work->result;
    napi_value js;
    napi_create_object(env, &js);
    const bool success = status == napi_ok && result.error.empty() && result.windowID != 0;
    SetBoolean(env, js, "success", success);
    if (!success) SetString(env, js, "error", result.error.empty() ? "capture-cancelled" : result.error);
    SetNumber(env, js, "windowId", result.windowID);
    SetString(env, js, "windowName", result.title);
    SetNumber(env, js, "windowLayer", result.layer);
    SetBoolean(env, js, "onScreen", result.onScreen);
    SetNumber(env, js, "width", result.width);
    SetNumber(env, js, "height", result.height);
    napi_value bounds;
    napi_create_object(env, &bounds);
    SetNumber(env, bounds, "x", result.bounds.origin.x);
    SetNumber(env, bounds, "y", result.bounds.origin.y);
    SetNumber(env, bounds, "width", result.bounds.size.width);
    SetNumber(env, bounds, "height", result.bounds.size.height);
    napi_set_named_property(env, js, "bounds", bounds);
    if (success && !result.png.empty()) {
        napi_value buffer;
        napi_create_buffer_copy(env, result.png.size(), result.png.data(), nullptr, &buffer);
        napi_set_named_property(env, js, "buffer", buffer);
    }
    napi_resolve_deferred(env, work->deferred, js);
    napi_delete_async_work(env, work->async);
}

napi_value Capture(napi_env env, napi_callback_info info) {
    size_t count = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    auto work = std::make_unique<Work>();
    if (count != 3 || napi_get_value_int32(env, args[0], &work->width) != napi_ok ||
        napi_get_value_int32(env, args[1], &work->height) != napi_ok ||
        napi_get_value_int32(env, args[2], &work->timeoutMs) != napi_ok ||
        work->width < 0 || work->width > 4096 || work->height < 0 || work->height > 4096 ||
        work->timeoutMs < 100 || work->timeoutMs > 10000) {
        napi_throw_type_error(env, nullptr, "Expected bounded width, height and timeout integers");
        return nullptr;
    }
    napi_value promise, name;
    napi_create_promise(env, &work->deferred, &promise);
    napi_create_string_utf8(env, "ARAMGG game capture", NAPI_AUTO_LENGTH, &name);
    if (napi_create_async_work(env, nullptr, name, ExecuteCapture, CompleteCapture,
        work.get(), &work->async) != napi_ok) {
        napi_throw_error(env, nullptr, "Cannot create game capture worker");
        return nullptr;
    }
    if (napi_queue_async_work(env, work->async) != napi_ok) {
        napi_delete_async_work(env, work->async);
        napi_throw_error(env, nullptr, "Cannot queue game capture worker");
        return nullptr;
    }
    work.release();
    return promise;
}

napi_value InspectOverlay(napi_env env, napi_callback_info info) {
    if (![NSThread isMainThread]) {
        napi_throw_error(env, nullptr, "Overlay inspection requires the application main thread");
        return nullptr;
    }
    size_t count = 1, length = 0;
    napi_value arg;
    void* bytes = nullptr;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    bool isBuffer = false;
    if (count != 1 || napi_is_buffer(env, arg, &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, arg, &bytes, &length) != napi_ok || length != sizeof(void*)) {
        napi_throw_type_error(env, nullptr, "Expected a BrowserWindow native handle");
        return nullptr;
    }
    void* pointer = nullptr;
    memcpy(&pointer, bytes, sizeof(pointer));
    NSView* view = (__bridge NSView*)pointer;
    NSWindow* window = view.window;
    napi_value js;
    napi_create_object(env, &js);
    SetNumber(env, js, "level", window.level);
    SetBoolean(env, js, "visible", window.visible);
    SetBoolean(env, js, "onActiveSpace", window.onActiveSpace);
    SetBoolean(env, js, "hidesOnDeactivate", window.hidesOnDeactivate);
    SetBoolean(env, js, "occluded", !(window.occlusionState & NSWindowOcclusionStateVisible));
    return js;
}

// Listen-only: Tab still reaches League; no typed text is stored or exposed.
CFMachPortRef tabTap = nullptr;
CFRunLoopSourceRef tabSource = nullptr;
bool tabDown = false;

bool GameIsFrontmost() {
    return [NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier
        isEqualToString:@"com.riotgames.LeagueofLegends.GameClient"];
}

CGEventRef OnTabEvent(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        tabDown = false;
        if (tabTap) CGEventTapEnable(tabTap, true);
        return event;
    }
    if (CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) != 48) return event;
    if (type == kCGEventKeyUp) { tabDown = false; return event; }
    if (type != kCGEventKeyDown) return event;
    const bool repeat = CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0;
    const auto modifiers = CGEventGetFlags(event) &
        (kCGEventFlagMaskCommand | kCGEventFlagMaskAlternate | kCGEventFlagMaskControl | kCGEventFlagMaskShift);
    if (!repeat) tabDown = !modifiers && GameIsFrontmost();
    return event;
}

void StopTabTap(void*) {
    if (tabSource) {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), tabSource, kCFRunLoopCommonModes);
        CFRelease(tabSource);
        tabSource = nullptr;
    }
    if (tabTap) { CFMachPortInvalidate(tabTap); CFRelease(tabTap); tabTap = nullptr; }
    tabDown = false;
}

napi_value TabState(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value arg;
    bool enabled = false;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    if (count != 1 || napi_get_value_bool(env, arg, &enabled) != napi_ok || !NSThread.isMainThread) {
        napi_throw_type_error(env, nullptr, "Expected enabled boolean on the main thread");
        return nullptr;
    }
    const bool authorized = CGPreflightListenEventAccess();
    if (!enabled || !authorized) StopTabTap(nullptr);
    if (enabled && authorized && !tabTap) {
        tabTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly, CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp),
            OnTabEvent, nullptr);
        if (tabTap) {
            tabSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tabTap, 0);
            if (tabSource) CFRunLoopAddSource(CFRunLoopGetMain(), tabSource, kCFRunLoopCommonModes);
            else StopTabTap(nullptr);
        }
    }
    napi_value js;
    napi_create_object(env, &js);
    SetBoolean(env, js, "authorized", authorized);
    SetBoolean(env, js, "listening", tabTap != nullptr);
    SetBoolean(env, js, "gameFrontmost", GameIsFrontmost());
    if (!GameIsFrontmost()) tabDown = false;
    SetBoolean(env, js, "held", tabDown);
    return js;
}

napi_value RequestTabAccess(napi_env env, napi_callback_info) {
    napi_value value;
    napi_get_boolean(env, CGRequestListenEventAccess(), &value);
    return value;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"captureGame", nullptr, Capture, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"inspectOverlay", nullptr, InspectOverlay, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"tabState", nullptr, TabState, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"requestTabAccess", nullptr, RequestTabAccess, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 4, properties);
    napi_add_env_cleanup_hook(env, StopTabTap, nullptr);
    return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
