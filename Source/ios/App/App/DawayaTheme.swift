import UIKit

/// Colors mirror the web app's final CSS palette so the native overlays blend
/// into the page instead of looking like a separate app.
struct DawayaTheme {
    let isDark: Bool
    let language: DawayaLanguage

    var strings: DawayaStrings { DawayaStrings(language: language) }

    var background: UIColor { isDark ? UIColor(hex: 0x121212) : UIColor(hex: 0xF8F9FA) }
    var surface: UIColor { isDark ? UIColor(hex: 0x2C2C2E) : UIColor(hex: 0xFFFFFF) }
    var surfaceSoft: UIColor { isDark ? UIColor(hex: 0x242426) : UIColor(hex: 0xF1F3F5) }
    var primaryText: UIColor { isDark ? UIColor(hex: 0xF5F5F7) : UIColor(hex: 0x1A1A1A) }
    var secondaryText: UIColor { isDark ? UIColor(hex: 0xAEB4BE) : UIColor(hex: 0x5B6470) }
    var tertiaryText: UIColor { isDark ? UIColor(hex: 0x9BA1AA) : UIColor(hex: 0x6B7280) }
    var separator: UIColor { isDark ? UIColor(hex: 0x3A3A3C) : UIColor(hex: 0xE2E5E9) }
    var accent: UIColor { isDark ? UIColor(hex: 0x4C9AFF) : UIColor(hex: 0x0B66C3) }
    var accentStrong: UIColor { isDark ? UIColor(hex: 0x0A84FF) : UIColor(hex: 0x0B66C3) }
    var accentSoft: UIColor { isDark ? UIColor(hex: 0x1B2F44) : UIColor(hex: 0xEAF2FB) }
    var onAccent: UIColor { .white }
    var danger: UIColor { isDark ? UIColor(hex: 0xFF8A80) : UIColor(hex: 0xB3261E) }
    var success: UIColor { isDark ? UIColor(hex: 0x57D98A) : UIColor(hex: 0x137A43) }

    var statusBarStyle: UIStatusBarStyle { isDark ? .lightContent : .darkContent }

    var semanticDirection: UISemanticContentAttribute {
        language.isRightToLeft ? .forceRightToLeft : .forceLeftToRight
    }

    func displayFont(size: CGFloat, weight: UIFont.Weight = .bold) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard !language.isRightToLeft else { return base }
        guard let descriptor = base.fontDescriptor.withDesign(.rounded) else { return base }
        return UIFont(descriptor: descriptor, size: size)
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
