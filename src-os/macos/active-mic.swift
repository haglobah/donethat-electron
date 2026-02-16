import Foundation
import CoreAudio
import AppKit

struct AudioProcessInfo: Codable {
    let pid: Int32
    let name: String?
    let bundleId: String?
}

enum HelperError: Error {
    case propertySize(OSStatus, AudioObjectPropertySelector)
    case propertyRead(OSStatus, AudioObjectPropertySelector)
}

func getPropertySize(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
    element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
) throws -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: element
    )
    var size: UInt32 = 0
    let status = AudioObjectGetPropertyDataSize(objectID, &address, 0, nil, &size)
    guard status == noErr else {
        throw HelperError.propertySize(status, selector)
    }
    return size
}

func getUInt32Property(objectID: AudioObjectID, selector: AudioObjectPropertySelector) throws -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    let status = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value)
    guard status == noErr else {
        throw HelperError.propertyRead(status, selector)
    }
    return value
}

func getPIDProperty(objectID: AudioObjectID, selector: AudioObjectPropertySelector) throws -> pid_t {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    let status = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value)
    guard status == noErr else {
        throw HelperError.propertyRead(status, selector)
    }
    return value
}

func getCFStringProperty(objectID: AudioObjectID, selector: AudioObjectPropertySelector) throws -> CFString {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString?
    var size = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, ptr)
    }
    guard status == noErr else {
        throw HelperError.propertyRead(status, selector)
    }
    guard let unwrapped = value else {
        throw HelperError.propertyRead(kAudioHardwareBadObjectError, selector)
    }
    return unwrapped
}

func getProcessObjectIDs() throws -> [AudioObjectID] {
    let size = try getPropertySize(
        objectID: AudioObjectID(kAudioObjectSystemObject),
        selector: kAudioHardwarePropertyProcessObjectList
    )

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var processIDs = Array(repeating: AudioObjectID(0), count: count)
    var dataSize = size

    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    let status = processIDs.withUnsafeMutableBytes { rawBuffer in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            rawBuffer.baseAddress!
        )
    }

    guard status == noErr else {
        throw HelperError.propertyRead(status, kAudioHardwarePropertyProcessObjectList)
    }
    return processIDs
}

func getBundleID(processObjectID: AudioObjectID) -> String? {
    do {
        let bundleID = try getCFStringProperty(objectID: processObjectID, selector: kAudioProcessPropertyBundleID)
        return bundleID as String
    } catch {
        return nil
    }
}

func getPID(processObjectID: AudioObjectID) -> Int32? {
    do {
        let pid = try getPIDProperty(objectID: processObjectID, selector: kAudioProcessPropertyPID)
        return Int32(pid)
    } catch {
        return nil
    }
}

func isRunningInput(processObjectID: AudioObjectID) -> Bool {
    do {
        let running = try getUInt32Property(objectID: processObjectID, selector: kAudioProcessPropertyIsRunningInput)
        return running == 1
    } catch {
        return false
    }
}

func resolveName(pid: Int32) -> String? {
    guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
        return nil
    }
    return app.localizedName
}

func getActiveMicrophoneProcesses() throws -> [AudioProcessInfo] {
    let processIDs = try getProcessObjectIDs()
    var active: [AudioProcessInfo] = []

    for processID in processIDs {
        guard isRunningInput(processObjectID: processID) else {
            continue
        }
        guard let pid = getPID(processObjectID: processID), pid > 0 else {
            continue
        }

        active.append(
            AudioProcessInfo(
                pid: pid,
                name: resolveName(pid: pid),
                bundleId: getBundleID(processObjectID: processID)
            )
        )
    }

    active.sort { $0.pid < $1.pid }
    return active
}

do {
    let processes = try getActiveMicrophoneProcesses()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let jsonData = try encoder.encode(processes)
    FileHandle.standardOutput.write(jsonData)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(EXIT_SUCCESS)
} catch {
    fputs("active-mic helper failed: \(error)\n", stderr)
    exit(EXIT_FAILURE)
}
