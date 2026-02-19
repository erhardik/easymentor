
# 🎓 LJ Attendance Follow-up ERP

A Django-based academic follow-up system that automates mentor calling workflow for low-attendance students.

Designed for colleges where mentors must call parents weekly and maintain records manually.

This system converts a 1–2 hour weekly manual task into a 5-minute guided workflow.

---

## 🚀 Main Purpose

In many institutes:

1. Coordinator uploads attendance Excel
2. Mentor manually finds students
3. Calls parents
4. Writes follow-up in register
5. Prepares weekly report
6. Sends WhatsApp summary

This project automates ALL of that.

---

## 👥 User Roles

### 1) Coordinator
- Upload student master (once)
- Upload weekly attendance
- View mentor performance
- Delete weeks / lock weeks
- See analytics

### 2) Mentor
- Login using short name (e.g. HDS)
- System shows only defaulters
- One-tap call parent
- Mark received / not received
- Auto retry reminder
- WhatsApp message ready
- Weekly report auto generated

---

## ⚙️ Features

### Attendance Processing
- Reads messy college Excel sheets
- Detects header automatically
- Extracts weekly & overall attendance
- Generates call list (<80%)

### Smart Call Workflow
- Tap CALL → opens dialer
- After return → mark received / not received
- After all calls → retry popup for missed parents
- WhatsApp message auto prepared

### Reports
- Mentor weekly report text
- Coordinator analytics dashboard
- Semester attendance register (dynamic columns)
- Printable student follow-up sheet (A4 landscape)

### Automation
- No manual data entry
- No manual calculations
- No copy-paste WhatsApp
- No manual registers

---

## 🧠 Technology

Backend: Django + SQLite  
Frontend: Bootstrap responsive UI  
Parsing: Pandas Excel reader  
Network: LAN / ngrok supported

---

## 🖥️ Run Locally


pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
`

Open:
[http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## 🌐 Use in Department LAN

Run:

python manage.py runserver 0.0.0.0:8000


Students connect via:

http://YOUR-IP:8000


---

## 📱 Test on Mobile (Outside Network)

Use ngrok:

ngrok http 8000


---

## 🏫 Designed For

* Engineering colleges
* Attendance compliance systems
* NAAC / NBA documentation
* Mentor-mentee programs

---

## ✍️ Author

Made with AI assistance by **Hardik Shah**
LJ Institute of Engineering & Technology



---
## EasyMentor

This repository now supports:

- Coordinator web app (existing Django screens)
- Mentor mobile app (new Expo React Native app)

## Backend (Django)

1. Install dependencies used by current project (`django`, `pandas`, `reportlab`).
2. Apply migrations:

```bash
python manage.py migrate
```

3. Run server:

```bash
python manage.py runserver 0.0.0.0:8000
```

## New Mobile API Endpoints

- `POST /api/mobile/login/`
- `POST /api/mobile/logout/`
- `GET /api/mobile/weeks/`
- `GET /api/mobile/calls/?week=<n>`
- `POST /api/mobile/save-call/`
- `POST /api/mobile/mark-message/`
- `GET /api/mobile/retry-list/?week=<n>`

Auth method: `Authorization: Bearer <token>`

## Mentor Mobile App (Expo)

App path: `mentor_mobile_app/`

1. Install Node.js LTS and Expo CLI tooling (`npx expo` is enough).
2. Update backend URL in:

- `mentor_mobile_app/src/constants.js`

Set `API_BASE_URL` to your server IP, for example:

```js
export const API_BASE_URL = "http://192.168.1.10:8000";
```

3. Run app:

```bash
cd mentor_mobile_app
npm install
npm run start
```

4. Open on Android (Expo Go or emulator).
5. If prompted, allow notifications on device.

## Build APK / AAB with EAS

`eas.json` is preconfigured at `mentor_mobile_app/eas.json`.

From `mentor_mobile_app/` run:

```bash
npm install
npm install -g eas-cli
eas login
eas build:configure
```

### Internal testing APK

```bash
eas build -p android --profile preview
```

### Internal testing APK (skip fingerprint upload)

```bash
eas build -p android --profile preview-no-fingerprint
```

### Development client APK

```bash
eas build -p android --profile development
```

### Play Store production AAB

```bash
eas build -p android --profile production
```

## Notes

- Coordinator continues using web app.
- Mentors use mobile app with same backend data in near-real time.
- Mobile app includes call workflow with return-to-app popup and auto duration estimate.
- Mobile app now supports persistent login using AsyncStorage.
- Mobile app sends local push notification when retry pending count increases.

## Public Hosting (Coordinator + Mobile)

Files added for deployment:
- `requirements.txt`
- `Procfile`
- `render.yaml`
- production-ready env config in `mentor_followup/settings.py`

### Important

No provider can guarantee "free forever". Free tiers can change.  
Best practical approach is deploy on free tier and keep backup/export of data.

### Deploy on Render (free tier)

1. Push project to GitHub.
2. In Render, create new Blueprint and select your repo.
3. Render reads `render.yaml` and creates web service.
4. Add a persistent database URL in env var `DATABASE_URL` (recommended: free Postgres provider).
5. Keep `DEBUG=False` in production.
6. Run initial superuser setup from Render shell:

```bash
python manage.py createsuperuser
```

### Connect mobile app to hosted backend

After deploy you get URL like:
`https://your-service.onrender.com`

In app:
- open `Server`/`Change Server`
- enter hosted URL
- save

No APK rebuild is required after this, unless you change app code.
