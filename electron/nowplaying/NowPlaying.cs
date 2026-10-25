// Raven Ambient Bold · 外部音乐信息
//
// Windows 的系统媒体会话（SMTC）是唯一能知道「别的播放器正在放什么」的接口，
// 而它只能在原生层调用，浏览器里拿不到。所以做成一个独立小程序：
//
//   NowPlaying.exe --watch      长驻，状态变化时往 stdout 写一行 JSON
//   NowPlaying.exe --once       查一次就退出（调试用）
//   NowPlaying.exe --list       列出所有媒体会话，看能认出谁
//
// 只读，不控制别人的播放器，不改任何系统设置。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Collections.Concurrent;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

static class Win {
    public static T Get<T>(IAsyncOperation<T> op) {
        using (var done = new ManualResetEventSlim(false)) {
            T result = default(T);
            Exception error = null;
            op.Completed = delegate (IAsyncOperation<T> o, AsyncStatus status) {
                try {
                    if (status == AsyncStatus.Completed) result = o.GetResults();
                    else error = new Exception("状态 " + status);
                } catch (Exception e) { error = e; }
                finally { done.Set(); }
            };
            if (!done.Wait(4000)) throw new TimeoutException("超时");
            if (error != null) throw error;
            return result;
        }
    }

    /// <summary>TryTogglePlayPauseAsync 这类返回 IAsyncOperation&lt;bool&gt; 的，单独一份。</summary>
    public static bool GetBool(IAsyncOperation<bool> op) {
        using (var done = new ManualResetEventSlim(false)) {
            bool result = false;
            Exception error = null;
            op.Completed = delegate (IAsyncOperation<bool> o, AsyncStatus status) {
                try {
                    if (status == AsyncStatus.Completed) result = o.GetResults();
                    else error = new Exception("状态 " + status);
                } catch (Exception e) { error = e; }
                finally { done.Set(); }
            };
            if (!done.Wait(4000)) throw new TimeoutException("超时");
            if (error != null) throw error;
            return result;
        }
    }

    public static T GetProgress<T, P>(IAsyncOperationWithProgress<T, P> op) {
        using (var done = new ManualResetEventSlim(false)) {
            T result = default(T);
            Exception error = null;
            op.Completed = delegate (IAsyncOperationWithProgress<T, P> o, AsyncStatus status) {
                try {
                    if (status == AsyncStatus.Completed) result = o.GetResults();
                    else error = new Exception("状态 " + status);
                } catch (Exception e) { error = e; }
                finally { done.Set(); }
            };
            if (!done.Wait(4000)) throw new TimeoutException("超时");
            if (error != null) throw error;
            return result;
        }
    }
}

class Snapshot {
    public string app = "";
    public string title = "";
    public string artist = "";
    public string album = "";
    public string status = "";
    public string cover = "";      // 封面 base64（data URL 前缀由调用方补）
    public bool playing = false;

    public string Key() { return app + "\u0001" + title + "\u0001" + artist + "\u0001" + status + "\u0001" + cover.Length; }

    // 手写 JSON：字段少、要转义的只有文本，避免引入依赖
    public string ToJson() {
        var sb = new StringBuilder();
        sb.Append("{\"app\":").Append(Quote(app))
          .Append(",\"title\":").Append(Quote(title))
          .Append(",\"artist\":").Append(Quote(artist))
          .Append(",\"album\":").Append(Quote(album))
          .Append(",\"status\":").Append(Quote(status))
          .Append(",\"playing\":").Append(playing ? "true" : "false")
          .Append(",\"cover\":").Append(Quote(cover))
          .Append('}');
        return sb.ToString();
    }

    static string Quote(string s) {
        if (s == null) return "\"\"";
        var sb = new StringBuilder("\"");
        foreach (char c in s) {
            switch (c) {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }
}

class Program {
    // 认得的音乐播放器。按优先级排：越靠前越优先。
    // 浏览器也在列，因为很多人直接用网页版听歌；但它的缩略图常常是视频画面，所以排在后面。
    // 主循环和读 stdin 的线程都碰它，用并发队列，各自不用加锁。
    static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();

    static readonly string[] known = {
        "cloudmusic",       // 网易云音乐
        "qqmusic",          // QQ 音乐
        "kugou",            // 酷狗
        "kuwo",             // 酷我
        "spotify",
        "applemusic",
        "foobar",
        "musicbee",
        "aimp",
        "potplayer",
        "chrome", "msedge", "firefox",     // 网页播放器兜底
        "telegram",         // 常见于语音/视频，缩略图不是封面，放最后但仍可显示歌名
    };

    static int Rank(string aum) {
        string lower = aum.ToLowerInvariant();
        for (int i = 0; i < known.Length; i++) if (lower.Contains(known[i])) return i;
        return 999;
    }

    static byte[] ReadCover(GlobalSystemMediaTransportControlsSession s, out string mime) {
        mime = "";
        try {
            var props = Win.Get(s.TryGetMediaPropertiesAsync());
            if (props.Thumbnail == null) return null;
            var stream = Win.Get(props.Thumbnail.OpenReadAsync());
            ulong size = stream.Size;
            if (size == 0 || size > 4000000) return null;
            var input = stream.GetInputStreamAt(0);
            var buf = new Windows.Storage.Streams.Buffer((uint)size);
            var readOp = input.ReadAsync(buf, (uint)size, InputStreamOptions.None);
            var filled = Win.GetProgress<IBuffer, uint>(readOp);
            var bytes = new byte[filled.Length];
            using (var reader = DataReader.FromBuffer(filled)) reader.ReadBytes(bytes);
            mime = Sniff(bytes);
            return bytes;
        } catch { return null; }
    }

    // 有些播放器给的不是封面（比如浏览器给的是视频画面），按文件头判断真实类型
    static string Sniff(byte[] b) {
        if (b == null || b.Length < 12) return "";
        if (b[0] == 0xFF && b[1] == 0xD8) return "image/jpeg";
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57) return "image/webp";
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "image/gif";
        return "";
    }

    /// <summary>把动作发给当前那个会话。找不到目标就什么都不做，调用方自己会看到状态没变。</summary>
    static void Act(GlobalSystemMediaTransportControlsSessionManager mgr, string action) {
        var target = Target(mgr);
        if (target == null) return;
        switch (action) {
            case "toggle": Win.GetBool(target.TryTogglePlayPauseAsync()); break;
            case "next": Win.GetBool(target.TrySkipNextAsync()); break;
            // 前端发的是 "previous"（与 MediaAction 同名），这里两个都收，
                // 免得两边名字对不上时被静默丢掉。
                case "prev":
                case "previous": Win.GetBool(target.TrySkipPreviousAsync()); break;
        }
    }

    /// <summary>选会话的规则和 Pick 一致：按播放器优先级 + 播放状态。</summary>
    static GlobalSystemMediaTransportControlsSession Target(GlobalSystemMediaTransportControlsSessionManager mgr) {
        GlobalSystemMediaTransportControlsSession best = null;
        int bestScore = int.MaxValue;
        foreach (var s in mgr.GetSessions()) {
            string aum = s.SourceAppUserModelId ?? "";
            if (aum.Length == 0) continue;
            int rank = Rank(aum);
            if (rank >= 999) continue;
            int score = rank;
            try {
                var info = s.GetPlaybackInfo();
                if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) score += 0;
                else if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused) score += 100;
                else score += 200;
            } catch { score += 300; }
            if (score < bestScore) { bestScore = score; best = s; }
        }
        return best;
    }

    static Snapshot Pick(GlobalSystemMediaTransportControlsSessionManager mgr) {
        var sessions = mgr.GetSessions();
        GlobalSystemMediaTransportControlsSession best = null;
        int bestScore = int.MaxValue;
        foreach (var s in sessions) {
            string aum = s.SourceAppUserModelId ?? "";
            if (aum.Length == 0) continue;
            int rank = Rank(aum);
            if (rank >= 999) continue;
            int score = rank;
            try {
                var info = s.GetPlaybackInfo();
                // 正在放的优先于暂停的，暂停的优先于停止的
                if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) score += 0;
                else if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused) score += 100;
                else score += 200;
            } catch { score += 300; }
            if (score < bestScore) { bestScore = score; best = s; }
        }

        if (best == null) return new Snapshot { status = "None" };

        var snap = new Snapshot();
        try {
            snap.app = best.SourceAppUserModelId ?? "";
            var props = Win.Get(best.TryGetMediaPropertiesAsync());
            snap.title = props.Title ?? "";
            snap.artist = props.Artist ?? "";
            snap.album = props.AlbumTitle ?? "";
            var info = best.GetPlaybackInfo();
            snap.status = info.PlaybackStatus.ToString();
            snap.playing = snap.status == "Playing";
            string mime;
            var bytes = ReadCover(best, out mime);
            if (bytes != null && mime.Length > 0) {
                snap.cover = "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
            }
        } catch { }
        return snap;
    }

    static int Main(string[] args) {
        string mode = args.Length > 0 ? args[0] : "--once";
        GlobalSystemMediaTransportControlsSessionManager mgr;
        try {
            mgr = Win.Get(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
        } catch (Exception e) {
            Console.Error.WriteLine("SMTC 不可用: " + e.GetType().Name);
            return 2;
        }

        if (mode == "--list") {
            foreach (var s in mgr.GetSessions()) {
                string line = s.SourceAppUserModelId;
                try {
                    var p = Win.Get(s.TryGetMediaPropertiesAsync());
                    var i = s.GetPlaybackInfo();
                    line += "  [" + i.PlaybackStatus + "]  " + p.Title + " — " + p.Artist;
                } catch { }
                Console.WriteLine(line);
            }
            return 0;
        }

        if (mode == "--once") {
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(Pick(mgr).ToJson());
            return 0;
        }

        // --watch：长驻。每 0.7 秒查一次，只在内容变化时输出一行，省得调用方反复解析。
        // 同时从 stdin 收动作命令（play 暂停切换 / next / prev），这样控制外部播放器
        // 不需要另起进程——起一次 SMTC 连接要几百毫秒，按键会明显迟滞。
        var enc = new UTF8Encoding(false);
        var stdout = new StreamWriter(Console.OpenStandardOutput(), enc);
        stdout.AutoFlush = true;
        string lastKey = null;

        var reader = new Thread(() =>
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    line = line.Trim().ToLowerInvariant();
                    if (line.Length > 0) commands.Enqueue(line);
                }
            }
            catch { /* stdin 关了就当没命令，不影响轮询 */ }
        });
        reader.IsBackground = true;
        reader.Start();

        while (true)
        {
            string action;
            while (commands.TryDequeue(out action)) Act(mgr, action);

            try {
                var snap = Pick(mgr);
                string key = snap.Key();
                if (key != lastKey) {
                    lastKey = key;
                    stdout.WriteLine(snap.ToJson());
                }
            } catch { /* 播放器刚关掉这类瞬时错误，下一轮再说 */ }
            Thread.Sleep(700);
        }
    }
}
