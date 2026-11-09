#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
// Window/input only. All graphics and compute are owned by Deno's native wgpu.
static NSWindow *window;
static NSView *view;
static bool closed=false, blurred=false, locked=false;
static double oldWidth=0,oldHeight=0;
extern void *objc_autoreleasePoolPush(void);
extern void objc_autoreleasePoolPop(void *);
static void *framePool;
@interface BardoWindowDelegate : NSObject <NSWindowDelegate>
@end
@implementation BardoWindowDelegate
-(BOOL)windowShouldClose:(id)sender {closed=true;return NO;}
-(void)windowDidResignKey:(NSNotification *)notification {blurred=true;}
-(void)requestQuit:(id)sender {closed=true;}
@end
static BardoWindowDelegate *delegate;
int bardo_open(int width,int height){
 framePool=objc_autoreleasePoolPush();
 @autoreleasepool {
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  delegate=[BardoWindowDelegate new];NSMenu *menu=[NSMenu new];NSMenuItem *item=[NSMenuItem new];[menu addItem:item];NSMenu *sub=[NSMenu new];NSMenuItem *quit=[sub addItemWithTitle:@"Quit" action:@selector(requestQuit:) keyEquivalent:@"q"];quit.target=delegate;[item setSubmenu:sub];[NSApp setMainMenu:menu];
  window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,width,height) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  window.delegate=delegate;
  window.title=@"Bardo · native wgpu";window.minSize=NSMakeSize(480,320);window.contentMaxSize=NSMakeSize(1920,1080);window.acceptsMouseMovedEvents=YES;
  view=[[NSView alloc] initWithFrame:NSMakeRect(0,0,width,height)];view.wantsLayer=YES;view.layer=[CAMetalLayer layer];window.contentView=view;
  [window center];[window makeKeyAndOrderFront:nil];[NSApp finishLaunching];[NSApp activateIgnoringOtherApps:YES];
  oldWidth=width;oldHeight=height;return 1;
 }
}
void *bardo_window(void){return (__bridge void *)window;}
void *bardo_display(void){return (__bridge void *)view;}
void bardo_title(const char *s){@autoreleasepool{window.title=[NSString stringWithUTF8String:s];}}
void bardo_lock(int value){if(locked==(bool)value)return;locked=value;CGAssociateMouseAndMouseCursorPosition(!locked);if(locked)[NSCursor hide];else[NSCursor unhide];}
int bardo_poll(double *out){
 // Native Metal calls also create autoreleased Cocoa objects between FFI calls.
 // An NSApplication-run loop normally drains these; our Deno-owned loop must
 // do it, otherwise drawable objects accumulate until the swapchain stalls.
 if(framePool)objc_autoreleasePoolPop(framePool);
 framePool=objc_autoreleasePoolPush();
 @autoreleasepool {
  // Deno owns the event loop, so AppKit's usual idle transaction observer does
  // not run for us. Commit layer/window updates even when no input arrives.
  [NSApp updateWindows];[CATransaction flush];
  memset(out,0,64);
  if(closed){out[0]=9;return 1;}if(blurred){blurred=false;out[0]=8;return 1;}
  NSSize size=view.bounds.size;if(size.width!=oldWidth||size.height!=oldHeight){oldWidth=size.width;oldHeight=size.height;out[0]=7;out[1]=oldWidth;out[2]=oldHeight;return 1;}
  NSEvent *e=[NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate distantPast] inMode:NSDefaultRunLoopMode dequeue:YES];if(!e)return 0;
  NSPoint p=[view convertPoint:e.locationInWindow fromView:nil];out[1]=p.x;out[2]=size.height-p.y;
  NSEventModifierFlags m=e.modifierFlags;out[7]=((m&NSEventModifierFlagShift)?1:0)|((m&NSEventModifierFlagControl)?2:0)|((m&NSEventModifierFlagOption)?4:0)|((m&NSEventModifierFlagCommand)?8:0);
  switch(e.type){
   case NSEventTypeMouseMoved:case NSEventTypeLeftMouseDragged:case NSEventTypeRightMouseDragged:case NSEventTypeOtherMouseDragged:out[0]=1;out[3]=e.deltaX;out[4]=e.deltaY;break;
   case NSEventTypeLeftMouseDown:case NSEventTypeRightMouseDown:case NSEventTypeOtherMouseDown:out[0]=2;out[5]=e.buttonNumber==1?2:e.buttonNumber==2?1:e.buttonNumber;break;
   case NSEventTypeLeftMouseUp:case NSEventTypeRightMouseUp:case NSEventTypeOtherMouseUp:out[0]=3;out[5]=e.buttonNumber==1?2:e.buttonNumber==2?1:e.buttonNumber;break;
   case NSEventTypeScrollWheel:out[0]=4;out[3]=-e.scrollingDeltaX;out[4]=-e.scrollingDeltaY*(e.hasPreciseScrollingDeltas?1:20);break;
   case NSEventTypeKeyDown:case NSEventTypeKeyUp:{out[0]=e.type==NSEventTypeKeyDown?5:6;NSString *s=e.charactersIgnoringModifiers;out[6]=s.length?[s characterAtIndex:0]:0;out[5]=e.isARepeat;break;}
   case NSEventTypeFlagsChanged:out[0]=(m&NSEventModifierFlagShift)?5:6;out[6]=0x10;break;
   default:out[0]=10;break;
  }
  [NSApp sendEvent:e];[NSApp updateWindows];return 1;
 }
}
void bardo_close(void){bardo_lock(0);[window orderOut:nil];}
void bardo_status(double *out){out[0]=window.isVisible;out[1]=window.occlusionState;out[2]=NSApp.isActive;out[3]=[NSThread isMainThread];out[4]=view.bounds.size.width;out[5]=view.bounds.size.height;out[6]=window.windowNumber;out[7]=((CAMetalLayer *)view.layer).drawableSize.width;}
