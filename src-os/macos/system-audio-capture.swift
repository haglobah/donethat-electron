import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreMedia

struct OutMessage: Encodable {
    let type: String
    let requestId: String?
    let message: String?
    let path: String?
    let startMs: Int64?
    let endMs: Int64?
    let mimeType: String?
}

final class Segment {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let filePath: String
    let startMs: Int64
    var sessionStarted = false

    init(writer: AVAssetWriter, input: AVAssetWriterInput, filePath: String, startMs: Int64) {
        self.writer = writer
        self.input = input
        self.filePath = filePath
        self.startMs = startMs
    }
}

@available(macOS 13.0, *)
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let audioQueue = DispatchQueue(label: "donethat.system-audio.queue")
    private let encodeQueue = DispatchQueue(label: "donethat.system-audio.encode")
    private var stream: SCStream?
    private var currentSegment: Segment?
    private var stopping = false

    private func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func emit(_ msg: OutMessage) {
        do {
            let data = try JSONEncoder().encode(msg)
            if let s = String(data: data, encoding: .utf8) {
                FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
            }
        } catch {
            let fallback = "{\"type\":\"error\",\"message\":\"failed to encode output message\"}\n"
            FileHandle.standardOutput.write(fallback.data(using: .utf8)!)
        }
    }

    private func makeNewSegment() throws -> Segment {
        let filePath = (NSTemporaryDirectory() as NSString).appendingPathComponent("donethat-system-audio-\(UUID().uuidString).m4a")
        let fileURL = URL(fileURLWithPath: filePath)

        let writer = try AVAssetWriter(url: fileURL, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 128000
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw NSError(domain: "SystemAudioCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add AVAssetWriterInput"])
        }
        writer.add(input)
        return Segment(writer: writer, input: input, filePath: filePath, startMs: nowMs())
    }

    private func rotateSegment(requestId: String?) {
        audioQueue.async {
            guard let oldSegment = self.currentSegment else {
                self.emit(OutMessage(type: "chunk", requestId: requestId, message: nil, path: nil, startMs: nil, endMs: nil, mimeType: "audio/mp4"))
                return
            }

            do {
                self.currentSegment = try self.makeNewSegment()
            } catch {
                self.emit(OutMessage(type: "error", requestId: requestId, message: "Failed to create new segment: \(error.localizedDescription)", path: nil, startMs: nil, endMs: nil, mimeType: nil))
                return
            }

            // If no sample ever arrived for this segment, the writer is still .unknown.
            // Calling markAsFinished in that state throws NSInternalInconsistencyException.
            if !oldSegment.sessionStarted || oldSegment.writer.status == .unknown {
                let emptyPath = oldSegment.filePath
                try? FileManager.default.removeItem(atPath: emptyPath)
                self.emit(OutMessage(
                    type: "chunk",
                    requestId: requestId,
                    message: nil,
                    path: nil,
                    startMs: oldSegment.startMs,
                    endMs: self.nowMs(),
                    mimeType: "audio/mp4"
                ))
                return
            }

            oldSegment.input.markAsFinished()
            let endMs = self.nowMs()
            self.encodeQueue.async {
                oldSegment.writer.finishWriting {
                    if oldSegment.writer.status == .completed {
                        self.emit(OutMessage(
                            type: "chunk",
                            requestId: requestId,
                            message: nil,
                            path: oldSegment.filePath,
                            startMs: oldSegment.startMs,
                            endMs: endMs,
                            mimeType: "audio/mp4"
                        ))
                    } else {
                        let writerErr = oldSegment.writer.error?.localizedDescription ?? "unknown writer error"
                        self.emit(OutMessage(type: "error", requestId: requestId, message: "Failed to finalize segment: \(writerErr)", path: nil, startMs: nil, endMs: nil, mimeType: nil))
                    }
                }
            }
        }
    }

    func startCapture() async throws {
        let shareable = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = shareable.displays.first else {
            throw NSError(domain: "SystemAudioCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "No display available"])
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        config.queueDepth = 6

        self.stream = SCStream(filter: filter, configuration: config, delegate: self)
        guard let stream = self.stream else {
            throw NSError(domain: "SystemAudioCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to initialize SCStream"])
        }

        self.currentSegment = try makeNewSegment()
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        try await stream.startCapture()
        emit(OutMessage(type: "ready", requestId: nil, message: nil, path: nil, startMs: nil, endMs: nil, mimeType: nil))
    }

    func stopCapture() {
        guard !stopping else { return }
        stopping = true
        rotateSegment(requestId: "stop-final")
        Task {
            do {
                try await stream?.stopCapture()
            } catch {}
            emit(OutMessage(type: "stopped", requestId: nil, message: nil, path: nil, startMs: nil, endMs: nil, mimeType: nil))
            exit(EXIT_SUCCESS)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(OutMessage(type: "error", requestId: nil, message: "SCStream stopped with error: \(error.localizedDescription)", path: nil, startMs: nil, endMs: nil, mimeType: nil))
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio else { return }
        guard CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let segment = currentSegment else { return }

        if !segment.sessionStarted {
            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            if segment.writer.startWriting() {
                segment.writer.startSession(atSourceTime: pts)
                segment.sessionStarted = true
            } else {
                emit(OutMessage(type: "error", requestId: nil, message: "Failed to start writer session", path: nil, startMs: nil, endMs: nil, mimeType: nil))
                return
            }
        }

        if segment.input.isReadyForMoreMediaData {
            _ = segment.input.append(sampleBuffer)
        }
    }

    func handleCommand(_ line: String) {
        guard let data = line.data(using: .utf8) else { return }
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let cmd = obj["cmd"] as? String
        else {
            emit(OutMessage(type: "error", requestId: nil, message: "Invalid command payload", path: nil, startMs: nil, endMs: nil, mimeType: nil))
            return
        }

        if cmd == "flush" {
            rotateSegment(requestId: obj["requestId"] as? String)
            return
        }
        if cmd == "stop" {
            stopCapture()
            return
        }
        emit(OutMessage(type: "error", requestId: nil, message: "Unknown command: \(cmd)", path: nil, startMs: nil, endMs: nil, mimeType: nil))
    }
}

if #available(macOS 13.0, *) {
    let capture = SystemAudioCapture()

    Task {
        do {
            try await capture.startCapture()
        } catch {
            let msg = OutMessage(type: "error", requestId: nil, message: "Failed to start capture: \(error.localizedDescription)", path: nil, startMs: nil, endMs: nil, mimeType: nil)
            if let data = try? JSONEncoder().encode(msg),
               let str = String(data: data, encoding: .utf8) {
                FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
            }
            exit(EXIT_FAILURE)
        }
    }

    DispatchQueue.global(qos: .utility).async {
        while let line = readLine() {
            capture.handleCommand(line)
        }
        capture.stopCapture()
    }

    dispatchMain()
} else {
    let msg = OutMessage(type: "error", requestId: nil, message: "macOS 13+ required for ScreenCaptureKit system audio helper", path: nil, startMs: nil, endMs: nil, mimeType: nil)
    if let data = try? JSONEncoder().encode(msg),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    }
    exit(EXIT_FAILURE)
}
