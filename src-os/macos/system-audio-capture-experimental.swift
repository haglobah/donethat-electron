import Foundation
import CoreAudio

// Minimal standalone Option 2 probe (CoreAudio Process Tap + Aggregate Device).

struct OutMessage: Encodable {
    let type: String
    let message: String?
    let code: String?
}

@available(macOS 14.2, *)
final class TapProbe {
    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?

    private func log(_ message: String) {
        if let data = ("[TapProbe] " + message + "\n").data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }

    private func emit(_ msg: OutMessage) {
        if let data = try? JSONEncoder().encode(msg),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
        }
    }

    private func statusString(_ status: OSStatus) -> String {
        if status == noErr { return "0(noErr)" }
        let n = UInt32(bitPattern: status)
        let bytes: [UInt8] = [
            UInt8((n >> 24) & 0xFF),
            UInt8((n >> 16) & 0xFF),
            UInt8((n >> 8) & 0xFF),
            UInt8(n & 0xFF)
        ]
        return "\(status)(\(String(bytes: bytes, encoding: .ascii) ?? "????"))"
    }

    private func getTapUID(_ tap: AudioObjectID) throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uidCF: CFString?
        var size = UInt32(MemoryLayout<CFString?>.size)
        let status = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &uidCF)
        guard status == noErr, let uidCF else {
            throw NSError(domain: "TapProbe", code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: "getTapUID failed status=\(statusString(status))"
            ])
        }
        return uidCF as String
    }

    private func getTapList() -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTapList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
        guard sizeStatus == noErr, size >= UInt32(MemoryLayout<AudioObjectID>.size) else {
            return []
        }
        let count = Int(size) / MemoryLayout<AudioObjectID>.size
        var taps = [AudioObjectID](repeating: kAudioObjectUnknown, count: count)
        let readStatus = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &taps)
        guard readStatus == noErr else { return [] }
        return taps.filter { $0 != kAudioObjectUnknown }
    }

    private func resolveTapID(_ uid: String) -> AudioObjectID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToTap,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var qualifier: CFString = uid as CFString
        var out = AudioObjectID(kAudioObjectUnknown)
        var outSize = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = withUnsafeMutablePointer(to: &qualifier) { qptr in
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                UInt32(MemoryLayout<CFString>.size),
                qptr,
                &outSize,
                &out
            )
        }
        log("translateUIDToTap status=\(statusString(status)) out=\(out)")
        return status == noErr ? out : kAudioObjectUnknown
    }

    private func defaultOutputUID() throws -> String {
        let selectors: [AudioObjectPropertySelector] = [
            kAudioHardwarePropertyDefaultOutputDevice,
            kAudioHardwarePropertyDefaultSystemOutputDevice
        ]
        for selector in selectors {
            var address = AudioObjectPropertyAddress(
                mSelector: selector,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var deviceID = AudioObjectID(kAudioObjectUnknown)
            var size = UInt32(MemoryLayout<AudioObjectID>.size)
            let status = AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                &size,
                &deviceID
            )
            log("default output selector=\(selector) status=\(statusString(status)) deviceID=\(deviceID)")
            if status != noErr || deviceID == kAudioObjectUnknown { continue }

            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var uidCF: CFString?
            var uidSize = UInt32(MemoryLayout<CFString?>.size)
            let uidStatus = AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, &uidCF)
            if uidStatus == noErr, let uidCF {
                return uidCF as String
            }
        }
        throw NSError(domain: "TapProbe", code: -1, userInfo: [
            NSLocalizedDescriptionKey: "Unable to resolve default output device UID"
        ])
    }

    func start() throws {
        log("start: begin")
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        desc.name = "DoneThat Tap Probe"
        let requestedUUID = desc.uuid.uuidString
        log("tap requested uuid=\(requestedUUID) private=\(desc.isPrivate)")

        var created = AudioObjectID(kAudioObjectUnknown)
        let createStatus = AudioHardwareCreateProcessTap(desc, &created)
        log("AudioHardwareCreateProcessTap status=\(statusString(createStatus)) created=\(created)")
        guard createStatus == noErr else {
            throw NSError(domain: "TapProbe", code: Int(createStatus), userInfo: [
                NSLocalizedDescriptionKey: "AudioHardwareCreateProcessTap failed"
            ])
        }

        let translated = resolveTapID(requestedUUID)
        if translated != kAudioObjectUnknown {
            tapID = translated
        } else {
            for candidate in getTapList() {
                if let uid = try? getTapUID(candidate), uid == requestedUUID {
                    tapID = candidate
                    break
                }
            }
        }
        if tapID == kAudioObjectUnknown {
            throw NSError(domain: "TapProbe", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Tap object not materialized"
            ])
        }
        let actualTapUID = try getTapUID(tapID)
        log("tap resolved id=\(tapID) uid=\(actualTapUID)")

        let outUID = try defaultOutputUID()
        log("output uid=\(outUID)")
        let tapEntry: [String: Any] = [
            String(kAudioSubTapUIDKey): actualTapUID,
            String(kAudioSubTapDriftCompensationKey): 1
        ]
        let subDeviceEntry: [String: Any] = [
            String(kAudioSubDeviceUIDKey): outUID
        ]
        let aggregateDesc: [String: Any] = [
            String(kAudioAggregateDeviceNameKey): "DoneThat Tap Probe Aggregate",
            String(kAudioAggregateDeviceUIDKey): "com.donethat.tapprobe.\(UUID().uuidString)",
            String(kAudioAggregateDeviceIsPrivateKey): 1,
            String(kAudioAggregateDeviceSubDeviceListKey): [subDeviceEntry],
            String(kAudioAggregateDeviceMainSubDeviceKey): outUID,
            String(kAudioAggregateDeviceTapListKey): [tapEntry],
            String(kAudioAggregateDeviceTapAutoStartKey): 1
        ]
        let aggregateKeys = Array(aggregateDesc.keys).joined(separator: ",")
        log("creating aggregate keys=\(aggregateKeys)")

        var agg = AudioObjectID(kAudioObjectUnknown)
        let aggStatus = AudioHardwareCreateAggregateDevice(aggregateDesc as CFDictionary, &agg)
        log("AudioHardwareCreateAggregateDevice status=\(statusString(aggStatus)) aggregate=\(agg)")
        guard aggStatus == noErr, agg != kAudioObjectUnknown else {
            throw NSError(domain: "TapProbe", code: Int(aggStatus), userInfo: [
                NSLocalizedDescriptionKey: "AudioHardwareCreateAggregateDevice failed"
            ])
        }
        aggregateID = agg

        var proc: AudioDeviceIOProcID?
        let procStatus = AudioDeviceCreateIOProcIDWithBlock(&proc, aggregateID, nil) { _, _, _, _, _ in }
        log("AudioDeviceCreateIOProcIDWithBlock status=\(statusString(procStatus))")
        guard procStatus == noErr, let proc else {
            throw NSError(domain: "TapProbe", code: Int(procStatus), userInfo: [
                NSLocalizedDescriptionKey: "AudioDeviceCreateIOProcIDWithBlock failed"
            ])
        }
        ioProcID = proc

        let startStatus = AudioDeviceStart(aggregateID, proc)
        log("AudioDeviceStart status=\(statusString(startStatus))")
        guard startStatus == noErr else {
            throw NSError(domain: "TapProbe", code: Int(startStatus), userInfo: [
                NSLocalizedDescriptionKey: "AudioDeviceStart failed"
            ])
        }

        emit(OutMessage(type: "ready", message: "tap probe started", code: nil))
    }

    func stop() {
        if let ioProcID {
            _ = AudioDeviceStop(aggregateID, ioProcID)
            _ = AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            _ = AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            _ = AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
    }
}

if #available(macOS 14.2, *) {
    let probe = TapProbe()
    do {
        try probe.start()
    } catch {
        let msg = OutMessage(type: "error", message: "Tap probe failed: \(error.localizedDescription)", code: "tap_probe_failed")
        if let data = try? JSONEncoder().encode(msg),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
        }
        exit(EXIT_FAILURE)
    }

    // Keep running for manual inspection; stop on stdin close.
    while readLine() != nil {}
    probe.stop()
    exit(EXIT_SUCCESS)
} else {
    let msg = OutMessage(type: "error", message: "Tap probe requires macOS 14.2+", code: "unsupported_os")
    if let data = try? JSONEncoder().encode(msg),
       let line = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
    exit(EXIT_FAILURE)
}
