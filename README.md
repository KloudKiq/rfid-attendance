# RFID Attendance

مشروع حضور موظفين محلي بسيط — قارئ RFID USB + واجهة ويب.

## Screenshots

### شاشة المسح (Kiosk)
![Kiosk](docs/kiosk.png)

### لوحة الإدارة (Admin Panel)
![Admin](docs/admin.png)

## التشغيل (تطبيق ويندوز)

التطبيق الآن تطبيق ويندوز مكتبي (Electron) — نافذة، أيقونة في شريط النظام (Tray)، وتشغيل تلقائي مع بدء تشغيل ويندوز.

```bash
npm install
npm run electron   # تشغيل التطبيق محلياً للتطوير/الاختبار
```

لإنشاء ملف تثبيت `.exe` لويندوز:

```bash
npm run dist        # يحتاج Wine على macOS/Linux، أو نفّذه على ويندوز مباشرة
```

أو استخدم GitHub Actions workflow المرفق (`.github/workflows/build-windows.yml`) — يبني ملف التثبيت على `windows-latest` ويرفعه كـ artifact (أو للـ Release عند دفع تاغ `v*`)، دون الحاجة لـ Wine.

بعد التثبيت، قاعدة البيانات تُحفظ في مجلد بيانات المستخدم (`%APPDATA%\rfid-attendance\attendance.db`) وليس داخل مجلد البرنامج.

### تشغيل الخادم مباشرة (بدون واجهة، اختياري)

```bash
npm start
```

```
http://localhost:3000        ← شاشة المسح
http://localhost:3000/admin.html  ← لوحة الإدارة
```

### ملاحظة عن الوحدات الأصلية (Native Modules)

`better-sqlite3` و`node-hid` و`serialport` تحتاج إعادة بناء مختلفة حسب البيئة: Electron ABI عند تشغيل `npm run electron` أو `npm run dist`، أو Node ABI العادي عند `npm start`/`npm test`. بعد استخدام Electron، شغّل التالي قبل الاختبارات:

```bash
npm run rebuild:node
npm test
```

## بيانات الإدارة الافتراضية

```
admin / admin123
```

يمكن تغييرها عند أول تشغيل:

```bash
ADMIN_USER=admin ADMIN_PASS=YourStrongPass npm start
```

## طريقة العمل مع قارئ RFID USB

- **تسجيل حضور/خروج**: مرر البطاقة مباشرة — لا حاجة للنقر في أي مكان.
- **تعريف موظف جديد**: افتح `/admin.html`، سجل دخول، ثم امسح البطاقة في خانة رقم البطاقة.
- قاعدة البيانات: `attendance.db` (تُنشأ تلقائياً).
