using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// The service accepts configuration data, never command lines or executable paths.
internal static class NavioServiceProgram
{
    internal const int Protocol = 1;
    internal const int MaxRequest = 256 * 1024 * 1024;
    internal static string Owner;
    internal static string Id;
    internal static string Name { get { return "NavioCore-" + Id; } }
    internal static string Pipe { get { return "NavioCore-" + Id; } }
    internal static string ApiPipe { get { return "NavioCoreApi-" + Id; } }
    internal static string InstallDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Navio Service", Id); } }
    internal static string WorkDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Navio Service", Id); } }
    internal static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = MaxRequest, RecursionLimit = 100 }; }
    internal static string Hash(byte[] bytes) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    internal static string Text(IDictionary<string, object> value, string key) { object result; return value.TryGetValue(key, out result) ? result as string : null; }
    internal static string Quote(string value) { return "\"" + value.Replace("\\", "\\").Replace("\"", "\\\"") + "\""; }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "self-test") return ServicePolicy.SelfTest();
            if (args.Length < 1) throw new Exception("Missing operation.");
            Owner = args.Length > 1 ? args[1] : WindowsIdentity.GetCurrent().User.Value;
            var sid = new SecurityIdentifier(Owner);
            if (!sid.IsAccountSid()) throw new Exception("A Windows account SID is required.");
            Id = Hash(Encoding.UTF8.GetBytes(Owner)).Substring(0, 16);
            switch (args[0])
            {
                case "identity": Console.WriteLine(Json().Serialize(new { sid = Owner, id = Id, pipe = Pipe, apiPipe = ApiPipe, protocol = Protocol })); return 0;
                case "serve": ServiceBase.Run(new CoreService()); return 0;
                case "install": Install(); return 0;
                case "uninstall": Uninstall(); return 0;
                case "uninstall-ui":
                    Process.Start(new ProcessStartInfo(Path.Combine(InstallDir, "NavioService.exe"), "uninstall " + Owner) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
                    return 0;
                case "bridge": return Bridge();
                default: throw new Exception("Unsupported operation.");
            }
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    internal static void NoReparse(string target)
    {
        for (var current = Path.GetFullPath(target); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new Exception("Reparse points are not allowed in service paths.");
    }

    static void Protect(string directory, bool ownerRead)
    {
        NoReparse(directory);
        Directory.CreateDirectory(directory);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        if (ownerRead) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Owner), FileSystemRights.ReadAndExecute, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        Directory.SetAccessControl(directory, security);
    }

    static void RequireAdmin()
    {
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new Exception("Administrator approval is required.");
    }

    static void Sc(params string[] arguments)
    {
        using (var process = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "sc.exe"), String.Join(" ", arguments.Select(Quote))) { UseShellExecute = false, CreateNoWindow = true }))
        {
            if (!process.WaitForExit(20000)) throw new Exception("Service management timed out.");
            if (process.ExitCode != 0) throw new Exception("Service management failed: " + process.ExitCode);
        }
    }

    static bool Exists() { return ServiceController.GetServices().Any(service => service.ServiceName == Name); }
    static void StopInstalled()
    {
        if (!Exists()) return;
        using (var service = new ServiceController(Name))
        {
            if (service.Status != ServiceControllerStatus.Stopped) { service.Stop(); service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20)); }
        }
    }

    static void Install()
    {
        RequireAdmin();
        StopInstalled();
        var source = AppDomain.CurrentDomain.BaseDirectory;
        Protect(Path.GetDirectoryName(InstallDir), true);
        RemoveTree(InstallDir, InstallDir);
        Protect(InstallDir, true);
        Protect(Path.GetDirectoryName(WorkDir), false);
        RemoveTree(WorkDir, WorkDir);
        Protect(WorkDir, false);
        foreach (var entry in ServiceCoreHashes.Values)
        {
            var from = Path.GetFullPath(Path.Combine(source, "..", "sidecar", entry.Key));
            NoReparse(from);
            var bytes = File.ReadAllBytes(from);
            if (Hash(bytes) != entry.Value) throw new Exception("Core checksum mismatch: " + entry.Key);
            var destination = Path.Combine(InstallDir, entry.Key);
            NoReparse(destination);
            File.WriteAllBytes(destination, bytes);
        }
        var executable = Path.Combine(InstallDir, "NavioService.exe");
        NoReparse(executable);
        File.Copy(Path.Combine(source, "NavioService.exe"), executable, true);
        var command = Quote(executable) + " serve " + Owner;
        if (Exists()) Sc("config", Name, "binPath=", command, "start=", "auto");
        else Sc("create", Name, "binPath=", command, "start=", "auto", "DisplayName=", "Navio TUN Service (" + Id + ")");
        Sc("description", Name, "Navio network core service. Managed from Navio TUN settings.");
        Sc("start", Name);
        using (var service = new ServiceController(Name)) service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
        using (var key = Registry.LocalMachine.CreateSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\" + Name))
        {
            key.SetValue("DisplayName", "Navio TUN Service (" + Id + ")");
            key.SetValue("Publisher", "D.E.X Studio");
            key.SetValue("UninstallString", Quote(executable) + " uninstall-ui " + Owner);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    static void Uninstall()
    {
        RequireAdmin();
        StopInstalled();
        if (Exists()) Sc("delete", Name);
        var ownExecutable = Process.GetCurrentProcess().MainModule.FileName;
        foreach (var directory in new[] { InstallDir, WorkDir })
        {
            if (ownExecutable.Equals(Path.Combine(directory, "NavioService.exe"), StringComparison.OrdinalIgnoreCase))
            {
                NoReparse(directory);
                foreach (var file in Directory.EnumerateFiles(directory)) { NoReparse(file); if (!file.Equals(ownExecutable, StringComparison.OrdinalIgnoreCase)) File.Delete(file); }
                var script = "Wait-Process -Id " + Process.GetCurrentProcess().Id + " -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '" + ownExecutable.Replace("'", "''") + "' -Force; Remove-Item -LiteralPath '" + directory.Replace("'", "''") + "'";
                Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"), "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script))) { UseShellExecute = false, CreateNoWindow = true });
                continue;
            }
            RemoveTree(directory, directory);
        }
        Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\" + Name, false);
    }

    static void RemoveTree(string root, string directory)
    {
        var absolute = Path.GetFullPath(directory);
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (!absolute.Equals(prefix, StringComparison.OrdinalIgnoreCase) && !absolute.StartsWith(prefix + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid service removal path.");
        NoReparse(absolute);
        if (!Directory.Exists(absolute)) return;
        foreach (var entry in Directory.EnumerateFileSystemEntries(absolute))
        {
            NoReparse(entry);
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.Directory) != 0) RemoveTree(root, entry);
            else File.Delete(entry);
        }
        // Non-recursive deletion refuses new entries; it never follows a substituted junction.
        Directory.Delete(absolute, false);
    }

    static int Bridge()
    {
        using (var pipe = new NamedPipeClientStream(".", Pipe, PipeDirection.InOut, PipeOptions.None, TokenImpersonationLevel.Identification))
        {
            pipe.Connect(5000);
            var input = Console.ReadLine();
            if (input == null || input.Length > MaxRequest) throw new Exception("Invalid service request.");
            var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
            var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true);
            writer.WriteLine(input);
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                var message = Json().Deserialize<Dictionary<string, object>>(line);
                var kind = Text(message, "type");
                if (kind == "stdout") Console.WriteLine(Text(message, "text"));
                else if (kind == "stderr") Console.Error.WriteLine(Text(message, "text"));
                else if (kind == "error") throw new Exception(Text(message, "message"));
                else if (kind == "exit") return Convert.ToInt32(message["code"]);
                else Console.WriteLine(line);
            }
            return 0;
        }
    }

    internal static NamedPipeServerStream Listener(string name)
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Owner), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        return new NamedPipeServerStream(name, PipeDirection.InOut, 20, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security);
    }

    internal static void VerifyPeer(NamedPipeServerStream pipe)
    {
        string sid = null;
        pipe.RunAsClient(() => sid = WindowsIdentity.GetCurrent().User.Value);
        if (sid != Owner) throw new Exception("This service belongs to another Windows account.");
    }
}

internal sealed class CoreService : ServiceBase
{
    readonly object gate = new object();
    Process core;
    int port;
    string secret;
    bool running;
    NamedPipeServerStream commandListener;
    NamedPipeServerStream apiListener;

    internal CoreService() { ServiceName = NavioServiceProgram.Name; CanStop = true; AutoLog = false; }
    protected override void OnStart(string[] args)
    {
        running = true;
        new Thread(() => Accept(false)) { IsBackground = true }.Start();
        new Thread(() => Accept(true)) { IsBackground = true }.Start();
    }
    protected override void OnStop()
    {
        running = false;
        if (commandListener != null) commandListener.Dispose();
        if (apiListener != null) apiListener.Dispose();
        lock (gate) StopCore();
    }
    void Accept(bool api)
    {
        while (running)
        {
            NamedPipeServerStream pipe = null;
            try
            {
                pipe = NavioServiceProgram.Listener(api ? NavioServiceProgram.ApiPipe : NavioServiceProgram.Pipe);
                if (api) apiListener = pipe; else commandListener = pipe;
                pipe.WaitForConnection();
                var accepted = pipe;
                ThreadPool.QueueUserWorkItem(_ => { using (accepted) { try { NavioServiceProgram.VerifyPeer(accepted); if (api) Api(accepted); else Command(accepted); } catch { } } });
            }
            catch { if (pipe != null) pipe.Dispose(); if (running) Thread.Sleep(200); }
        }
    }
    void StopCore()
    {
        if (core == null) return;
        try { if (!core.HasExited) { core.Kill(); if (!core.WaitForExit(10000)) throw new Exception("The previous core did not stop."); } } finally { core.Dispose(); core = null; port = 0; secret = null; }
    }
    static string ReadLine(StreamReader reader)
    {
        var line = new StringBuilder();
        int value;
        while ((value = reader.Read()) >= 0)
        {
            if (value == '\n') break;
            if (line.Length >= NavioServiceProgram.MaxRequest) throw new Exception("Service request is too large.");
            if (value != '\r') line.Append((char)value);
        }
        return line.ToString();
    }
    void Command(NamedPipeServerStream pipe)
    {
        var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true);
        var writeGate = new object();
        Action<object> send = value => { lock (writeGate) writer.WriteLine(NavioServiceProgram.Json().Serialize(value)); };
        Process owned = null;
        var detached = false;
        try
        {
            var request = NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(ReadLine(reader));
            var action = NavioServiceProgram.Text(request, "action");
            if (action == "status") { lock (gate) send(new { type = "status", protocol = NavioServiceProgram.Protocol, ready = true, running = core != null && !core.HasExited, coreHashes = ServiceCoreHashes.Values }); return; }
            if (action == "stop") { lock (gate) StopCore(); send(new { type = "stopped" }); return; }
            if (action != "start") throw new Exception("Unsupported service request.");
            lock (gate)
            {
                var name = NavioServiceProgram.Text(request, "core");
                string expected;
                if (!ServiceCoreHashes.Values.TryGetValue(name ?? "", out expected)) throw new Exception("Unsupported core.");
                var executable = Path.Combine(NavioServiceProgram.InstallDir, name);
                NavioServiceProgram.NoReparse(executable);
                if (NavioServiceProgram.Hash(File.ReadAllBytes(executable)) != expected) throw new Exception("Installed core checksum mismatch. Reinstall the service.");
                var config = request["config"] as Dictionary<string, object>;
                ServicePolicy.ValidateConfig(config, false);
                StopCore();
                var configDir = Path.Combine(NavioServiceProgram.WorkDir, "runtime");
                NavioServiceProgram.NoReparse(configDir);
                Directory.CreateDirectory(configDir);
                var assets = request["assets"] as IList;
                if (assets == null || assets.Count > 2048) throw new Exception("Invalid service resources.");
                long total = 0;
                foreach (Dictionary<string, object> asset in assets)
                {
                    var relative = NavioServiceProgram.Text(asset, "path");
                    ServicePolicy.SafeAsset(relative);
                    var data = Convert.FromBase64String(NavioServiceProgram.Text(asset, "data"));
                    total += data.Length;
                    if (total > 160 * 1024 * 1024) throw new Exception("Service resources exceed 160 MiB.");
                    var destination = Path.Combine(configDir, relative.Replace('/', Path.DirectorySeparatorChar));
                    NavioServiceProgram.NoReparse(destination);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    if (relative.StartsWith("providers/") || !File.Exists(destination)) File.WriteAllBytes(destination, data);
                }
                using (var random = RandomNumberGenerator.Create()) { var bytes = new byte[32]; random.GetBytes(bytes); secret = Convert.ToBase64String(bytes); }
                var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
                config["external-controller"] = "127.0.0.1:" + port;
                config["secret"] = secret;
                config["log-level"] = "info";
                config["external-controller-cors"] = new Dictionary<string, object> { { "allow-origins", new string[0] }, { "allow-private-network", false } };
                File.WriteAllText(Path.Combine(configDir, "config.json"), NavioServiceProgram.Json().Serialize(config), new UTF8Encoding(false));
                var info = new ProcessStartInfo(executable, "-d " + NavioServiceProgram.Quote(configDir) + " -f " + NavioServiceProgram.Quote(Path.Combine(configDir, "config.json"))) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = configDir, RedirectStandardOutput = true, RedirectStandardError = true };
                ServicePolicy.ClearPathOverrides(info);
                info.EnvironmentVariables.Remove("CLASH_AGE_SECRET_KEY");
                var ageKey = NavioServiceProgram.Text(request, "ageSecretKey");
                if (!String.IsNullOrEmpty(ageKey)) { if (ageKey.Length > 16384) throw new Exception("Invalid age key."); info.EnvironmentVariables["CLASH_AGE_SECRET_KEY"] = ageKey; }
                owned = new Process { StartInfo = info };
                core = owned;
                owned.OutputDataReceived += (_, entry) => { if (entry.Data != null) try { send(new { type = "stdout", text = entry.Data.Contains("RESTful API listening at:") ? "RESTful API pipe listening at: Navio service" : entry.Data }); } catch { } };
                owned.ErrorDataReceived += (_, entry) => { if (entry.Data != null) try { send(new { type = "stderr", text = entry.Data }); } catch { } };
                owned.Start(); owned.BeginOutputReadLine(); owned.BeginErrorReadLine();
                detached = request.ContainsKey("detached") && request["detached"] is bool && (bool)request["detached"];
                send(new { type = "started", pid = owned.Id });
                if (detached) return;
            }
            var active = owned;
            var disconnected = Task.Run(() => { try { reader.Read(); } catch { } });
            while (!active.HasExited && !disconnected.IsCompleted && running) Thread.Sleep(100);
            if (active.HasExited) send(new { type = "exit", code = active.ExitCode });
        }
        catch (Exception error) { try { send(new { type = "error", message = error.Message }); } catch { } }
        finally { if (owned != null && !detached) lock (gate) { if (core == owned) StopCore(); } }
    }

    void Api(NamedPipeServerStream pipe)
    {
        // Parse the request before connecting to the privileged controller. Chunked
        // request bodies and pipelining are deliberately not accepted.
        var header = new MemoryStream();
        var end = new byte[4];
        while (header.Length < 32768)
        {
            var value = pipe.ReadByte(); if (value < 0) return;
            header.WriteByte((byte)value);
            end[0] = end[1]; end[1] = end[2]; end[2] = end[3]; end[3] = (byte)value;
            if (end[0] == 13 && end[1] == 10 && end[2] == 13 && end[3] == 10) break;
        }
        var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
        var first = lines[0].Split(' ');
        if (first.Length != 3 || !first[2].StartsWith("HTTP/1.")) throw new Exception("Invalid HTTP request.");
        var length = 0; var seenContentLength = false; var websocket = false; var forwarded = new List<string>();
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0) continue;
            var at = line.IndexOf(':'); if (at <= 0) throw new Exception("Invalid HTTP header.");
            var key = line.Substring(0, at).ToLowerInvariant(); var value = line.Substring(at + 1).Trim();
            if (key == "transfer-encoding") throw new Exception("Chunked requests are not supported.");
            if (key == "content-length") { if (seenContentLength || !Int32.TryParse(value, out length) || length < 0 || length > 1024 * 1024) throw new Exception("Invalid request body length."); seenContentLength = true; }
            if (key == "upgrade") websocket = value.Equals("websocket", StringComparison.OrdinalIgnoreCase);
            if (key != "authorization" && key != "host" && key != "connection") forwarded.Add(line);
        }
        var body = new byte[length]; var offset = 0;
        while (offset < length) { var count = pipe.Read(body, offset, length - offset); if (count == 0) throw new Exception("Incomplete request body."); offset += count; }
        try { ServicePolicy.ValidateApi(first[0], first[1], body, websocket); }
        catch (Exception error)
        {
            var response = Encoding.UTF8.GetBytes(NavioServiceProgram.Json().Serialize(new { message = error.Message }));
            var denied = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + response.Length + "\r\n\r\n");
            pipe.Write(denied, 0, denied.Length); pipe.Write(response, 0, response.Length); return;
        }
        int target; string token;
        lock (gate) { if (core == null || core.HasExited) throw new Exception("Core is not running."); target = port; token = secret; }
        using (var client = new TcpClient())
        {
            client.Connect(IPAddress.Loopback, target);
            using (var upstream = client.GetStream())
            {
                var request = Encoding.ASCII.GetBytes(lines[0] + "\r\nHost: 127.0.0.1:" + target + "\r\nAuthorization: Bearer " + token + "\r\nConnection: " + (websocket ? "Upgrade" : "close") + "\r\n" + String.Join("\r\n", forwarded) + "\r\n\r\n");
                upstream.Write(request, 0, request.Length); upstream.Write(body, 0, body.Length);
                if (websocket) Task.Run(() => { try { pipe.CopyTo(upstream); } catch { } });
                upstream.CopyTo(pipe);
            }
        }
    }
}

internal static class ServicePolicy
{
    enum ConfigLocation { Root, ProviderMap, EndpointList, Endpoint, TransportOptions, Other }
    static readonly HashSet<string> Top = new HashSet<string>(("port socks-port redir-port tproxy-port mixed-port authentication skip-auth-prefixes allow-lan bind-address lan-allowed-ips lan-disallowed-ips mode log-level ipv6 interface-name routing-mark find-process-mode unified-delay tcp-concurrent global-client-fingerprint keep-alive-interval keep-alive-idle disable-keep-alive global-ua etag geodata-mode geodata-loader geo-auto-update geo-update-interval geox-url geoip geoip-code geosite geosite-code profile dns hosts sniffer tun ntp proxies proxy-groups proxy-providers rule-providers rules sub-rules listeners experimental store-selected store-fake-ip global-conn-new-ctrl global-conn-idle-close-timeout lgbm-auto-update lgbm-update-interval lgbm-url").Split(' '));
    static readonly HashSet<string> Patch = new HashSet<string>(("port socks-port redir-port tproxy-port mixed-port authentication skip-auth-prefixes allow-lan bind-address mode log-level ipv6 interface-name routing-mark find-process-mode unified-delay tcp-concurrent dns sniffer tun hosts").Split(' '));
    static readonly HashSet<string> Forbidden = new HashSet<string>(("external-controller external-controller-tls external-controller-unix external-controller-pipe external-ui external-ui-url external-ui-name external-controller-cors secret pre-up post-up pre-down post-down script command executable exec log-file directory working-directory state-dir ca-cert ca-file private-key-file certificate-file certificate-path cert-file key-file client-cert client-key client-auth-cert ech-key model-path").Split(' '), StringComparer.OrdinalIgnoreCase);
    internal static void SafeAsset(string path)
    {
        if (String.IsNullOrEmpty(path) || path.Length > 220 || path.Contains('\\') || path.Contains(':') || path.StartsWith("/") || path.Split('/').Any(segment => !Regex.IsMatch(segment, @"^[a-zA-Z0-9_.-]+$") || segment.EndsWith(".") || segment == "." || segment == ".." || Regex.IsMatch(segment, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase))) throw new Exception("Invalid service resource path.");
        if (path.EndsWith(".") || path.EndsWith(" ") || path.Equals("config.json", StringComparison.OrdinalIgnoreCase)) throw new Exception("Reserved service resource path.");
        var extension = Path.GetExtension(path).ToLowerInvariant();
        if (new[] { ".exe", ".dll", ".com", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".msi", ".lnk" }.Contains(extension)) throw new Exception("Executable service resources are not allowed.");
    }
    internal static void ValidateConfig(Dictionary<string, object> config, bool patch)
    {
        if (config == null) throw new Exception("A configuration object is required.");
        foreach (var key in config.Keys) if (!(patch ? Patch : Top).Contains(key)) throw new Exception("Service mode does not accept this setting: " + key + ". Use a one-time administrator session for this configuration.");
        object listeners;
        if (config.TryGetValue("listeners", out listeners) && listeners != null && (!(listeners is IList) || ((IList)listeners).Count != 0)) throw new Exception("Custom listeners require a one-time administrator session. Standard HTTP, SOCKS and mixed ports remain available in service mode.");
        Inspect(config, "", ConfigLocation.Root);
    }
    internal static void ClearPathOverrides(ProcessStartInfo info)
    {
        info.EnvironmentVariables.Remove("SAFE_PATHS");
        info.EnvironmentVariables.Remove("SKIP_SAFE_PATH_CHECK");
    }
    static void Inspect(object value, string parent, ConfigLocation location)
    {
        var map = value as Dictionary<string, object>;
        if (map != null)
        {
            foreach (var item in map)
            {
                if (location == ConfigLocation.ProviderMap) {
                    // Provider names are identifiers, not configuration fields.
                    Inspect(item.Value, "provider", ConfigLocation.Other);
                    continue;
                }
                // Mihomo's structure decoder compares field names without case
                // and accepts underscores in place of hyphens. Keep the original
                // dictionary intact, but apply policy to the same aliases.
                var keyName = item.Key.Replace('_', '-').ToLowerInvariant();
                if (Forbidden.Contains(keyName)) throw new Exception("Unsupported privileged setting: " + item.Key);
                if (parent == "ntp" && keyName == "write-to-system" && !Object.Equals(item.Value, false)) throw new Exception("Changing the system clock is not available in service mode.");
                if (keyName == "path" && location != ConfigLocation.TransportOptions) SafeAsset(item.Value as string);
                if (keyName == "masquerade") {
                    var text = item.Value as string; Uri uri;
                    if (text != "" && (text == null || !Uri.TryCreate(text, UriKind.Absolute, out uri) || !(uri.Scheme == "http" || uri.Scheme == "https"))) throw new Exception("File masquerade is not available in service mode.");
                }
                if (keyName == "certificate" || keyName == "private-key") {
                    var text = item.Value as string;
                    var inline = text == "" || (text != null && text.StartsWith("-----BEGIN ") && text.Contains('\n') && text.Contains("-----END "));
                    object type;
                    if (!inline && keyName == "private-key" && map.TryGetValue("type", out type) && Object.Equals(type, "wireguard") && text != null) {
                        try { var key = Convert.FromBase64String(text); inline = key.Length == 32 && Convert.ToBase64String(key) == text; } catch { }
                    }
                    if (!inline) throw new Exception("Inline certificate or key data is required in service mode.");
                }
                // Only a transport object directly inside a root endpoint array
                // contains URL paths. Provider names and nested keys are untrusted.
                var child = ConfigLocation.Other;
                if (location == ConfigLocation.Root && (keyName == "proxy-providers" || keyName == "rule-providers") && item.Value is Dictionary<string, object>) child = ConfigLocation.ProviderMap;
                if (location == ConfigLocation.Root && keyName == "proxies" && item.Value is IList) child = ConfigLocation.EndpointList;
                if (location == ConfigLocation.Endpoint && new[] { "ws-opts", "h2-opts", "http-opts" }.Contains(keyName) && item.Value is Dictionary<string, object>) child = ConfigLocation.TransportOptions;
                Inspect(item.Value, keyName, child);
            }
        }
        var array = value as IList; if (array != null) foreach (var item in array) Inspect(item, parent, location == ConfigLocation.EndpointList ? ConfigLocation.Endpoint : ConfigLocation.Other);
    }
    internal static void ValidateApi(string method, string target, byte[] body, bool websocket)
    {
        if (!target.StartsWith("/") || target.StartsWith("//") || target.Contains('\\') || target.Contains('#') || target.Any(ch => ch < 32)) throw new Exception("Invalid API target.");
        var path = target.Split('?')[0];
        var decoded = Uri.UnescapeDataString(path);
        if (decoded.Split('/').Any(part => part == "." || part == "..") || decoded.Contains('%')) throw new Exception("Invalid API path.");
        if (websocket && !(method == "GET" && new[] { "/logs", "/traffic", "/memory", "/connections" }.Contains(path))) throw new Exception("Unsupported stream.");
        if (method == "GET" && Regex.IsMatch(path, @"^/(?:$|version$|configs$|logs$|traffic$|memory$|connections(?:/.*)?$|proxies(?:/.*)?$|providers/(?:proxies|rules)(?:/.*)?$|rules$|group(?:/.*)?$|dns/query$)")) return;
        if (method == "PATCH" && path == "/configs") { ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body)), true); return; }
        if (method == "PUT" && Regex.IsMatch(path, @"^/proxies/[^/]+$")) { var data = NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body)); if (data.Count != 1 || !(data["name"] is string)) throw new Exception("Invalid proxy selection."); return; }
        if (method == "PUT" && body.Length == 0 && Regex.IsMatch(path, @"^/providers/(?:proxies|rules)/[^/]+$")) return;
        if (method == "DELETE" && Regex.IsMatch(path, @"^/(?:connections(?:/[^/]+)?|proxies/[^/]+|cache/fakeip)$")) return;
        if (method == "POST" && body.Length == 0 && (path == "/configs/geo" || Regex.IsMatch(path, @"^/cache/smart/flush(?:/[^/]+)?$"))) return;
        throw new Exception("This operation is unavailable in service mode. Manage core files in Navio, or use a one-time administrator session.");
    }
    internal static int SelfTest()
    {
        var tests = 0;
        Action<Action> rejected = action => { try { action(); } catch { tests++; return; } throw new Exception("Expected a policy rejection."); };
        foreach (var path in new[] { "../a", "C:/Windows/a", "a\\b", "/a", "CON.dat", "x.exe", "config.json", "a//b" }) rejected(() => SafeAsset(path));
        foreach (var target in new[] { "/upgrade", "/upgrade/ui", "/restart", "/configs?force=true", "/x/../upgrade", "/%75pgrade", "//upgrade" }) rejected(() => ValidateApi("POST", target, new byte[0], false));
        rejected(() => ValidateConfig(new Dictionary<string, object> { { "external-ui", "C:/Windows" } }, false));
        rejected(() => ValidateConfig(new Dictionary<string, object> { { "tun", new Dictionary<string, object> { { "post-up", "cmd" } } } }, false));
        rejected(() => ValidateApi("PATCH", "/configs", Encoding.UTF8.GetBytes("{\"secret\":\"replacement\"}"), false));
        rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"proxies\":[{\"private-key\":\"C:/Windows/system.ini\"}]}"), false));
        rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"proxy-providers\":{\"example\":{\"path\":\"../../Windows/a\"}}}"), false));
        rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"ntp\":{\"write-to-system\":true}}"), false));
        foreach (var provider in new[] { "proxy-providers", "rule-providers" })
            foreach (var name in new[] { "ws-opts", "h2-opts", "http-opts" })
                foreach (var path in new[] { "config.json", "C:/Windows/unsafe.yaml" })
                    rejected(() => ValidateConfig(new Dictionary<string, object> { { provider, new Dictionary<string, object> { { name, new Dictionary<string, object> { { "path", path } } } } } }, false));
        foreach (var malformed in new[] {
            "{\"proxies\":{\"ws-opts\":{\"path\":\"config.json\"}}}",
            "{\"proxies\":{\"[]\":{\"ws-opts\":{\"path\":\"config.json\"}}}}",
            "{\"proxies\":[{\"options\":{\"ws-opts\":{\"path\":\"config.json\"}}}]}",
            "{\"listeners\":[{\"ws-opts\":{\"nested\":{\"path\":\"config.json\"}}}]}"
        }) rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(malformed), false));
        ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"lgbm-auto-update\":false,\"lgbm-update-interval\":72,\"lgbm-url\":\"\",\"proxies\":[{\"ws-opts\":{\"path\":\"/connect\"}}]}"), false); tests++;
        ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"proxies\":[{\"ws-opts\":{\"path\":\"/ws\"},\"h2-opts\":{\"path\":\"/h2\"},\"http-opts\":{\"path\":[\"/one\",\"/two\"]}}],\"listeners\":[],\"mixed-port\":7890}"), false); tests++;
        foreach (var config in new[] {
            "{\"listeners\":[{\"type\":\"hysteria2\",\"masquerade\":\"file:///C:/Windows\"}]}",
            "{\"listeners\":[{\"type\":\"http\",\"port\":8080}]}",
            "{\"listeners\":{}}",
            "{\"proxies\":[{\"masquerade\":\"file:///C:/Windows\"}]}",
            "{\"proxies\":[{\"masquerade\":\"FILE:///C:/Windows\"}]}",
            "{\"proxies\":[{\"certificate\":\"/Windows/System32/config/SAM\"}]}",
            "{\"proxies\":[{\"private-key\":\"/Windows/System32/config/SAM\"}]}",
            "{\"proxies\":[{\"private-key\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\"}]}",
            "{\"proxies\":[{\"client-auth-cert\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"ech-key\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"state-dir\":\"C:/Windows\"}]}"
        }) rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(config), false));
        ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"proxies\":[{\"type\":\"wireguard\",\"private-key\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\"},{\"private-key\":\"-----BEGIN PRIVATE KEY-----\\nAQID\\n-----END PRIVATE KEY-----\"}]}"), false); tests++;
        foreach (var config in new[] {
            "{\"proxy-providers\":{\"Ws-Opts\":{\"Path\":\"config.json\"}}}",
            "{\"rule-providers\":{\"HTTP_OPTS\":{\"PATH\":\"C:/Windows/unsafe.yaml\"}}}",
            "{\"proxies\":[{\"Private-Key\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"Private_Key\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"Certificate\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"Client-Auth-Cert\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"CLIENT_AUTH_CERT\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"Ech_Key\":\"C:/Windows/system.ini\"}]}",
            "{\"proxies\":[{\"State_Dir\":\"C:/Windows\"}]}",
            "{\"proxies\":[{\"Masquerade\":\"file:///C:/Windows\"}]}",
            "{\"tun\":{\"Post_Up\":\"cmd\"}}",
            "{\"ntp\":{\"Write-To-System\":true}}",
            "{\"ntp\":{\"Write_To_System\":1}}",
            "{\"ntp\":{\"write-to-system\":\"true\"}}"
        }) rejected(() => ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>(config), false));
        ValidateConfig(NavioServiceProgram.Json().Deserialize<Dictionary<string, object>>("{\"proxy-providers\":{\"Ws_Opts\":{\"Path\":\"providers/example.yaml\"},\"CLIENT_AUTH_CERT\":{\"Path\":\"providers/another.yaml\"}},\"proxies\":[{\"WS_Opts\":{\"Path\":\"/connect\"}}],\"ntp\":{\"Write_To_System\":false}}"), false); tests++;
        var environment = new ProcessStartInfo(); environment.EnvironmentVariables["SAFE_PATHS"] = "C:/"; environment.EnvironmentVariables["SKIP_SAFE_PATH_CHECK"] = "1";
        ClearPathOverrides(environment);
        if (environment.EnvironmentVariables.ContainsKey("SAFE_PATHS") || environment.EnvironmentVariables.ContainsKey("SKIP_SAFE_PATH_CHECK")) throw new Exception("Unsafe core path environment was retained."); tests++;
        SafeAsset("providers/example.yaml"); tests++;
        ValidateConfig(new Dictionary<string, object> { { "tun", new Dictionary<string, object> { { "enable", true } } } }, false); tests++;
        ValidateApi("GET", "/proxies/group/delay?timeout=5000", new byte[0], false); tests++;
        Console.WriteLine("Service policy tests passed: " + tests); return 0;
    }
}
