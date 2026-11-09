#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <string.h>
// Same eight-double event ABI as macOS; window/input only, no graphics API.
static HWND window;static HINSTANCE instance;static int closed,locked;static double queue[256][8];static unsigned rd,wr;static POINT previous;
static void emit(int type,double x,double y,double dx,double dy,double button,double key){if(wr-rd>=256)return;double *e=queue[wr++%256];e[0]=type;e[1]=x;e[2]=y;e[3]=dx;e[4]=dy;e[5]=button;e[6]=key;e[7]=((GetKeyState(VK_SHIFT)&0x8000)?1:0)|((GetKeyState(VK_CONTROL)&0x8000)?2:0)|((GetKeyState(VK_MENU)&0x8000)?4:0);}
static LRESULT CALLBACK proc(HWND w,UINT m,WPARAM wp,LPARAM lp){
 double x=GET_X_LPARAM(lp),y=GET_Y_LPARAM(lp);
 switch(m){case WM_CLOSE:closed=1;return 0;case WM_SIZE:emit(7,LOWORD(lp),HIWORD(lp),0,0,0,0);break;case WM_KILLFOCUS:emit(8,0,0,0,0,0,0);break;
 case WM_INPUT:if(locked){RAWINPUT input;UINT bytes=sizeof(input);if(GetRawInputData((HRAWINPUT)lp,RID_INPUT,&input,&bytes,sizeof(RAWINPUTHEADER))!=((UINT)-1)&&input.header.dwType==RIM_TYPEMOUSE&&!(input.data.mouse.usFlags&MOUSE_MOVE_ABSOLUTE))emit(1,previous.x,previous.y,input.data.mouse.lLastX,input.data.mouse.lLastY,0,0);}break;
 case WM_MOUSEMOVE:if(!locked)emit(1,x,y,x-previous.x,y-previous.y,0,0);previous=(POINT){(LONG)x,(LONG)y};break;
 case WM_LBUTTONDOWN:case WM_RBUTTONDOWN:case WM_MBUTTONDOWN:SetCapture(w);emit(2,x,y,0,0,m==WM_LBUTTONDOWN?0:m==WM_RBUTTONDOWN?2:1,0);break;
 case WM_LBUTTONUP:case WM_RBUTTONUP:case WM_MBUTTONUP:ReleaseCapture();emit(3,x,y,0,0,m==WM_LBUTTONUP?0:m==WM_RBUTTONUP?2:1,0);break;
 case WM_MOUSEWHEEL:{POINT p={(LONG)x,(LONG)y};ScreenToClient(w,&p);emit(4,p.x,p.y,0,-GET_WHEEL_DELTA_WPARAM(wp),0,0);break;}
 case WM_KEYDOWN:case WM_SYSKEYDOWN:case WM_KEYUP:case WM_SYSKEYUP:emit(m==WM_KEYDOWN||m==WM_SYSKEYDOWN?5:6,0,0,0,0,(lp>>30)&1,wp);break;
 }return DefWindowProcW(w,m,wp,lp);
}
__declspec(dllexport) int bardo_open(int width,int height){instance=GetModuleHandleW(NULL);WNDCLASSW wc={0};wc.lpfnWndProc=proc;wc.hInstance=instance;wc.lpszClassName=L"BardoNativeWgpu";wc.hCursor=LoadCursor(NULL,IDC_ARROW);RegisterClassW(&wc);RECT r={0,0,width,height};AdjustWindowRect(&r,WS_OVERLAPPEDWINDOW,FALSE);window=CreateWindowW(wc.lpszClassName,L"Bardo - native wgpu",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,r.right-r.left,r.bottom-r.top,NULL,NULL,instance,NULL);RAWINPUTDEVICE mouse={0x01,0x02,0,window};RegisterRawInputDevices(&mouse,1,sizeof(mouse));ShowWindow(window,SW_SHOW);return window!=NULL;}
__declspec(dllexport) void *bardo_window(void){return window;}
__declspec(dllexport) void *bardo_display(void){return instance;}
__declspec(dllexport) void bardo_title(const char *s){wchar_t wide[1024];MultiByteToWideChar(CP_UTF8,0,s,-1,wide,1024);SetWindowTextW(window,wide);}
__declspec(dllexport) void bardo_lock(int value){if(locked==value)return;locked=value;ShowCursor(!locked);if(!locked)ClipCursor(NULL);else{RECT r;GetClientRect(window,&r);POINT p={0,0};ClientToScreen(window,&p);OffsetRect(&r,p.x,p.y);ClipCursor(&r);}}
__declspec(dllexport) int bardo_poll(double *out){MSG msg;for(int i=0;i<64&&PeekMessageW(&msg,NULL,0,0,PM_REMOVE);i++){TranslateMessage(&msg);DispatchMessageW(&msg);}memset(out,0,64);if(closed){out[0]=9;return 1;}if(rd==wr)return 0;memcpy(out,queue[rd++%256],64);return 1;}
__declspec(dllexport) void bardo_close(void){bardo_lock(0);ShowWindow(window,SW_HIDE);}
__declspec(dllexport) void bardo_status(double *out){memset(out,0,64);out[0]=IsWindowVisible(window);out[1]=!IsIconic(window);out[2]=GetForegroundWindow()==window;}
