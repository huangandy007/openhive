-- 0019_user_preference 回滚：整表丢弃（表里只有偏好，没有账）。
DROP TABLE IF EXISTS auth.user_preference;
