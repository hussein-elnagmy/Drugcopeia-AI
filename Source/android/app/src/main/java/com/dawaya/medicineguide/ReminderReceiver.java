package com.dawaya.medicineguide;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Fires at a reminder time, posts the alert with the bundled long chime, then
 * schedules the next day's alarms. Follow-up slots repeat every
 * {@link ReminderScheduler#ESCALATION_OFFSETS} minutes until the dose is
 * confirmed taken in the app.
 */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "dawaya_reminders_v2";
    private static final String LEGACY_CHANNEL_ID = "dawaya_reminders";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ReminderScheduler.ACTION_REMINDER.equals(intent.getAction())) return;
        String id = intent.getStringExtra("id");
        String name = intent.getStringExtra("name");
        String dose = intent.getStringExtra("dose");
        String time = intent.getStringExtra("time");
        int offset = intent.getIntExtra("offset", 0);
        if (name == null || name.trim().isEmpty()) return;

        ensureChannel(context);
        show(
            context,
            ReminderScheduler.requestCode(id == null ? "" : id, time == null ? "" : time, offset),
            name.trim(),
            dose == null ? "" : dose.trim(),
            time == null ? "" : time,
            offset
        );

        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        try {
            JSONObject item = new JSONObject();
            item.put("id", id == null ? "" : id);
            item.put("name", name);
            item.put("dose", dose == null ? "" : dose);
            item.put("time", time == null ? "" : time);
            // A new day starts with the full ladder again.
            ReminderScheduler.scheduleAll(context, manager, item);
        } catch (JSONException ignored) {
            // The current notification was already posted.
        }
    }

    private void show(Context context, int notificationId, String name, String dose, String time, int offset) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            contentIntent = PendingIntent.getActivity(context, notificationId, launch, flags);
        }
        String prefix = offset == 0 ? "" : (isArabic(context) ? "لم يُؤخذ بعد — " : "Still pending — ");
        String detail = dose.isEmpty() ? time : dose + " · " + time;
        String body = prefix + detail;
        String title = prefix.isEmpty() ? name : prefix + name;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setSound(alertSound(context))
            .setDefaults(0)
            // The medicine name is the user's own schedule, not a public announcement:
            // the lock screen shows only a generic line until the device is unlocked.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_reminder)
                .setContentTitle(isArabic(context) ? "تذكير دواء" : "Medicine reminder")
                .setContentText(isArabic(context) ? "افتح دوايا لعرض التفاصيل" : "Open Dawaya to see details")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .build());
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission was revoked after the alarm was set.
        }
    }

    private boolean isArabic(Context context) {
        String tag = Build.VERSION.SDK_INT >= 24
            ? context.getResources().getConfiguration().getLocales().get(0).getLanguage()
            : context.getResources().getConfiguration().locale.getLanguage();
        return "ar".equals(tag);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        // An existing channel keeps its sound forever, so the long alert tone
        // ships under a new id and the silent legacy channel is retired.
        NotificationChannel legacy = manager.getNotificationChannel(LEGACY_CHANNEL_ID);
        if (legacy != null) manager.deleteNotificationChannel(LEGACY_CHANNEL_ID);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.app_name) + " reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Daily medication reminders with repeating alerts");
        channel.enableVibration(true);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(alertSound(context), attributes);
        manager.createNotificationChannel(channel);
    }

    /** The bundled 20-second chime; the device default is the fallback. */
    static Uri alertSound(Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.dawaya_alert);
    }
}
