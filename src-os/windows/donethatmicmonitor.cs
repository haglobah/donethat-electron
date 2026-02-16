using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace DoneThatMicMonitor
{
    class Program
    {
        static readonly ERole[] CaptureRoles = new[]
        {
            ERole.eConsole,
            ERole.eCommunications,
            ERole.eMultimedia
        };

        static void Main(string[] args)
        {
            try
            {
                var sessions = GetActiveAudioSessions();
                var json = JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true });
                Console.WriteLine(json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error: {ex.Message}");
                Console.WriteLine("[]");
            }
        }

        static List<AudioSessionInfo> GetActiveAudioSessions()
        {
            var activeSessions = new List<AudioSessionInfo>();
            var seenPids = new HashSet<int>();
            IMMDeviceEnumerator enumerator = null;

            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();

                foreach (var role in CaptureRoles)
                {
                    IMMDevice device = null;
                    try
                    {
                        device = enumerator.GetDefaultAudioEndpoint(EDataFlow.eCapture, role);
                        CollectSessionsFromDevice(device, activeSessions, seenPids);
                    }
                    catch
                    {
                        // Continue with other roles if one endpoint is unavailable.
                    }
                    finally
                    {
                        SafeRelease(device);
                    }
                }
            }
            finally
            {
                SafeRelease(enumerator);
            }

            return activeSessions;
        }

        static void CollectSessionsFromDevice(IMMDevice device, List<AudioSessionInfo> activeSessions, HashSet<int> seenPids)
        {
            if (device == null) return;

            IAudioSessionManager2 sessionManager = null;
            IAudioSessionEnumerator sessionEnum = null;

            try
            {
                sessionManager = (IAudioSessionManager2)device.Activate(typeof(IAudioSessionManager2).GUID, 0, IntPtr.Zero);
                sessionEnum = sessionManager.GetSessionEnumerator();

                int count = sessionEnum.GetCount();
                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl sessionControl = null;
                    IAudioSessionControl2 sessionControl2 = null;

                    try
                    {
                        sessionControl = sessionEnum.GetSession(i);
                        sessionControl2 = (IAudioSessionControl2)sessionControl;

                        if (sessionControl.GetState() != AudioSessionState.AudioSessionStateActive) continue;
                        if (sessionControl2.IsSystemSoundsSession()) continue;

                        int pid = sessionControl2.GetProcessId();
                        if (pid <= 0) continue;
                        if (!seenPids.Add(pid)) continue;

                        string displayName = sessionControl.GetDisplayName();
                        if (string.IsNullOrWhiteSpace(displayName))
                        {
                            try
                            {
                                var proc = System.Diagnostics.Process.GetProcessById(pid);
                                displayName = proc.ProcessName;
                            }
                            catch
                            {
                                displayName = null;
                            }
                        }

                        activeSessions.Add(new AudioSessionInfo
                        {
                            pid = pid,
                            name = displayName ?? "Unknown",
                            isActive = true
                        });
                    }
                    catch
                    {
                        // Skip bad session and continue.
                    }
                    finally
                    {
                        SafeRelease(sessionControl2);
                        if (!object.ReferenceEquals(sessionControl, sessionControl2))
                        {
                            SafeRelease(sessionControl);
                        }
                    }
                }
            }
            finally
            {
                SafeRelease(sessionEnum);
                SafeRelease(sessionManager);
            }
        }

        static void SafeRelease(object comObj)
        {
            if (comObj == null) return;
            if (!Marshal.IsComObject(comObj)) return;

            try
            {
                Marshal.ReleaseComObject(comObj);
            }
            catch
            {
                // Ignore COM release failures.
            }
        }
    }

    public class AudioSessionInfo
    {
        public int pid { get; set; }
        public string name { get; set; }
        public bool isActive { get; set; }
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumerator
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        void EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out object ppDevices);
        [return: MarshalAs(UnmanagedType.Interface)]
        IMMDevice GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role);
        void GetDevice(string pwstrId, out IMMDevice ppDevice);
        void RegisterEndpointNotificationCallback(object pClient);
        void UnregisterEndpointNotificationCallback(object pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [return: MarshalAs(UnmanagedType.Interface)]
        object Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, uint dwClsCtx, IntPtr pActivationParams);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC2-33261279C942")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2
    {
        [return: MarshalAs(UnmanagedType.Interface)]
        object GetAudioSessionControl([MarshalAs(UnmanagedType.LPStruct)] Guid AudioSessionGuid, uint StreamFlags);
        [return: MarshalAs(UnmanagedType.Interface)]
        IAudioSessionEnumerator GetSessionEnumerator();
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator
    {
        int GetCount();
        [return: MarshalAs(UnmanagedType.Interface)]
        IAudioSessionControl GetSession(int SessionCount);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl
    {
        AudioSessionState GetState();
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string GetDisplayName();
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C647F13F74")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2 : IAudioSessionControl
    {
        new AudioSessionState GetState();
        [return: MarshalAs(UnmanagedType.LPWStr)]
        new string GetDisplayName();

        [return: MarshalAs(UnmanagedType.LPStr)]
        string GetSessionIdentifier();
        [return: MarshalAs(UnmanagedType.LPStr)]
        string GetSessionInstanceIdentifier();
        int GetProcessId();
        bool IsSystemSoundsSession();
    }

    internal enum EDataFlow
    {
        eRender,
        eCapture,
        eAll,
        EDataFlow_enum_count
    }

    internal enum ERole
    {
        eConsole,
        eMultimedia,
        eCommunications,
        ERole_enum_count
    }

    internal enum AudioSessionState
    {
        AudioSessionStateInactive = 0,
        AudioSessionStateActive = 1,
        AudioSessionStateExpired = 2
    }
}
