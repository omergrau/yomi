# יומי

אפליקציית אנדרואיד אישית לתכנון יום: מאגר משימות, גרירה ליום, ניקוד, קבוצות ותזכורות. הכל בעברית, ועובד בלי אינטרנט.

A personal day planner for Android, in Hebrew and right-to-left. Tasks live in a pool and are dragged into days. Finishing them earns points toward a daily bar, a streak and levels.

## מה יש בה

- מסך היום עם בר הספק, ניקוד של 1 עד 5 לכל משימה, רצף ורמות
- מאגר משימות במגירה, וגרירה ליום, לסדר אחר או ליום אחר בשבוע
- החלקה ימינה מוציאה מהיום, והחלקה שמאלה מעבירה למחר. תמיד אפשר לבטל
- קבוצות בשם חופשי, תצוגת שבוע ומסך ניקוד
- משימות לא גמורות עוברות למחר אוטומטית, עם היסטוריה מלאה של תאריכים ודחיות
- תאריך ושעה עתידיים, תזכורות ומשימות קבועות לפי ימים
- שמירה מקומית ב-SQLite, וגיבוי ושחזור מקובץ

## הרצה

צריך Node 22.13 ומעלה.

```bash
npm install
npm test
npm run typecheck
npm run web
```

בניית APK בענן של Expo:

```bash
npx eas-cli@latest build -p android --profile apk
```

## מבנה

- `src/domain`: כללי המוצר כפונקציות טהורות, עם בדיקות
- `src/data`: מסד הנתונים של הטלפון (SQLite), וגרסה בזיכרון לתצוגת הדפדפן
- `src/store.ts`: מצב האפליקציה. כל שינוי נשמר ואז מוצג
- `src/components`, `src/app`: המסכים והניווט (Expo Router)
- `src/i18n.ts`: כל הטקסטים, כדי ששפה נוספת תדרוש רק מילון נוסף

Built with React Native, Expo, TypeScript, Reanimated and Gesture Handler.
