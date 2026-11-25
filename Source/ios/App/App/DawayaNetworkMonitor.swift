import Foundation
import Network

/// Thin `NWPathMonitor` wrapper. Path updates are delivered on the main queue so
/// the shell can update UIKit without hopping threads again.
final class DawayaNetworkMonitor {
    enum Status {
        case unknown
        case online
        case offline
    }

    private(set) var status: Status = .unknown
    private(set) var isExpensive = false

    var onStatusChange: ((Status, Bool) -> Void)?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.dawaya.network-monitor")
    private var started = false

    func start() {
        guard !started else { return }
        started = true

        monitor.pathUpdateHandler = { [weak self] path in
            let next: Status = path.status == .satisfied ? .online : .offline
            let expensive = path.isExpensive
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.isExpensive = expensive
                guard self.status != next else { return }
                self.status = next
                self.onStatusChange?(next, expensive)
            }
        }
        monitor.start(queue: queue)
    }

    func stop() {
        guard started else { return }
        started = false
        monitor.cancel()
    }

    deinit {
        stop()
    }
}
