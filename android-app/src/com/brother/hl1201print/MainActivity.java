package com.brother.hl1201print;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.graphics.Insets;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.HashMap;

public class MainActivity extends Activity {
    private static final String ACTION_USB_PERMISSION = "com.brother.hl1201print.USB_PERMISSION";
    private static final int FILE_CHOOSER_RESULT_CODE = 1001;
    private static final int BROTHER_VENDOR_ID = 0x04F9; // 1273

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private UsbManager usbManager;
    private UsbDevice targetPrinter;

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                synchronized (this) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) {
                        targetPrinter = device;
                    }
                }
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        usbManager = (UsbManager) getSystemService(Context.USB_SERVICE);
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(usbReceiver, filter);
        }

        Intent launchIntent = getIntent();
        if (launchIntent != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(launchIntent.getAction())) {
            UsbDevice attached = launchIntent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (attached != null) {
                targetPrinter = attached;
            }
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new AndroidUsbBridge(), "AndroidUsb");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(intent, "Select Images"), FILE_CHOOSER_RESULT_CODE);
                return true;
            }
        });

        setContentView(webView);
        applySystemBarInsets(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void applySystemBarInsets(final View content) {
        if (Build.VERSION.SDK_INT >= 35) {
            Window window = getWindow();
            window.setDecorFitsSystemWindows(false);
            content.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View view, WindowInsets windowInsets) {
                    Insets bars = windowInsets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return windowInsets;
                }
            });
            content.requestApplyInsets();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) {
            UsbDevice attached = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (attached != null) {
                targetPrinter = attached;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clipData = data.getClipData();
                    int count = clipData.getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = clipData.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(usbReceiver);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    private PendingIntent createUsbPermissionIntent() {
        Intent intent = new Intent(ACTION_USB_PERMISSION);
        intent.setPackage(getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? PendingIntent.FLAG_MUTABLE : 0;
        return PendingIntent.getBroadcast(this, 0, intent, flags);
    }

    private UsbDevice findBrotherPrinter() {
        HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == BROTHER_VENDOR_ID) {
                return device;
            }
            for (int i = 0; i < device.getInterfaceCount(); i++) {
                if (device.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) {
                    return device;
                }
            }
        }
        return null;
    }

    public class AndroidUsbBridge {
        @JavascriptInterface
        public String connectPrinter() {
            UsbDevice dev = findBrotherPrinter();
            if (dev == null) {
                return "No USB printer found. Connect Brother HL-1201 via USB-C OTG.";
            }
            targetPrinter = dev;
            if (!usbManager.hasPermission(dev)) {
                usbManager.requestPermission(dev, createUsbPermissionIntent());
                return "Allow the USB OTG permission prompt on screen.";
            }
            return "Connected: Brother HL-1201 (USB OTG)";
        }

        @JavascriptInterface
        public String printBase64Job(String base64Payload) {
            UsbDevice dev = targetPrinter != null ? targetPrinter : findBrotherPrinter();
            if (dev == null) {
                return "Printer not connected on USB OTG.";
            }
            if (!usbManager.hasPermission(dev)) {
                usbManager.requestPermission(dev, createUsbPermissionIntent());
                return "Allow USB OTG permission and tap Print again.";
            }

            byte[] data = Base64.decode(base64Payload, Base64.DEFAULT);
            UsbInterface usbInterface = dev.getInterface(0);
            UsbEndpoint outEndpoint = null;

            for (int i = 0; i < usbInterface.getEndpointCount(); i++) {
                UsbEndpoint ep = usbInterface.getEndpoint(i);
                if (ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    outEndpoint = ep;
                    break;
                }
            }

            if (outEndpoint == null) {
                return "USB OUT endpoint not found.";
            }

            UsbDeviceConnection conn = usbManager.openDevice(dev);
            if (conn == null) {
                return "Could not open USB OTG device.";
            }

            try {
                conn.claimInterface(usbInterface, true);
                int chunkSize = 16384;
                int offset = 0;
                while (offset < data.length) {
                    int len = Math.min(chunkSize, data.length - offset);
                    byte[] chunk = new byte[len];
                    System.arraycopy(data, offset, chunk, 0, len);
                    int transferred = conn.bulkTransfer(outEndpoint, chunk, len, 15000);
                    if (transferred < 0) {
                        return "USB transfer failed at byte " + offset;
                    }
                    if (transferred == 0) {
                        return "USB transfer stopped at byte " + offset;
                    }
                    offset += transferred;
                }
                return "Printed (" + (data.length / 1024) + " KB sent over USB OTG).";
            } finally {
                conn.releaseInterface(usbInterface);
                conn.close();
            }
        }
    }
}
