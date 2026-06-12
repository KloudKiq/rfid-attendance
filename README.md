# RFID Attendance KISS

مشروع حضور موظفين محلي بسيط جدًا.

## التشغيل

```bash
npm install
npm start
```

افتح:

```text
http://localhost:3000
```

## بيانات الإدارة الافتراضية

```text
admin / admin123
```

يمكن تغييرها عند أول تشغيل:

```bash
ADMIN_USER=admin ADMIN_PASS=YourStrongPass npm start
```

## طريقة العمل مع قارئ RFID USB Keyboard

- لتسجيل حضور/خروج: ضع المؤشر في خانة المسح ومرر البطاقة.
- لتعريف موظف: سجل دخول كإدارة، ضع المؤشر في خانة رقم البطاقة ومرر البطاقة، ثم اكتب الاسم والمسمى.
- قاعدة البيانات ستكون في ملف `attendance.db`.