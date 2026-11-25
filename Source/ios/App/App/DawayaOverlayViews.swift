import UIKit

// MARK: - Loading

/// Native loading screen. The system launch storyboard shows immediately; this
/// view then bridges the gap until the web bundle calls the `ready` plugin hook.
final class DawayaLoadingView: UIView {
    private let logoShadow = UIView()
    private let logoView = UIImageView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let stack = UIStackView()
    private var theme = DawayaTheme(isDark: false, language: .english)

    override init(frame: CGRect) {
        super.init(frame: frame)
        setUp()
    }

    required init?(coder: NSCoder) {
        fatalError("Use init(frame:)")
    }

    private func setUp() {
        translatesAutoresizingMaskIntoConstraints = false
        accessibilityViewIsModal = true

        logoShadow.translatesAutoresizingMaskIntoConstraints = false
        logoShadow.layer.shadowColor = UIColor.black.cgColor
        logoShadow.layer.shadowOpacity = 0.16
        logoShadow.layer.shadowRadius = 20
        logoShadow.layer.shadowOffset = CGSize(width: 0, height: 8)

        logoView.translatesAutoresizingMaskIntoConstraints = false
        logoView.image = UIImage(named: "DawayaLogo")
        logoView.contentMode = .scaleAspectFill
        logoView.clipsToBounds = true
        logoView.layer.cornerRadius = 22
        logoView.layer.cornerCurve = .continuous
        logoShadow.addSubview(logoView)

        titleLabel.text = "Dawaya"
        titleLabel.textAlignment = .center
        titleLabel.adjustsFontForContentSizeCategory = true

        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 0
        subtitleLabel.adjustsFontForContentSizeCategory = true

        spinner.hidesWhenStopped = false
        spinner.transform = CGAffineTransform(scaleX: 1.15, y: 1.15)

        stack.axis = .vertical
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(logoShadow)
        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(subtitleLabel)
        stack.addArrangedSubview(spinner)
        stack.setCustomSpacing(22, after: logoShadow)
        stack.setCustomSpacing(6, after: titleLabel)
        stack.setCustomSpacing(22, after: subtitleLabel)
        addSubview(stack)

        NSLayoutConstraint.activate([
            logoShadow.widthAnchor.constraint(equalToConstant: 92),
            logoShadow.heightAnchor.constraint(equalToConstant: 92),
            logoView.topAnchor.constraint(equalTo: logoShadow.topAnchor),
            logoView.leadingAnchor.constraint(equalTo: logoShadow.leadingAnchor),
            logoView.trailingAnchor.constraint(equalTo: logoShadow.trailingAnchor),
            logoView.bottomAnchor.constraint(equalTo: logoShadow.bottomAnchor),

            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -12),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -28),
            subtitleLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 330)
        ])

        apply(theme: theme)
    }

    func apply(theme: DawayaTheme) {
        self.theme = theme
        backgroundColor = theme.background
        semanticContentAttribute = theme.semanticDirection
        stack.semanticContentAttribute = theme.semanticDirection
        titleLabel.font = theme.displayFont(size: 30, weight: .bold)
        titleLabel.textColor = theme.primaryText
        subtitleLabel.font = .systemFont(ofSize: 15, weight: .regular)
        subtitleLabel.textColor = theme.secondaryText
        subtitleLabel.text = theme.strings.loadingSubtitle
        spinner.color = theme.accent
    }

    func startAnimating() {
        spinner.startAnimating()
    }

    func stopAnimating() {
        spinner.stopAnimating()
    }
}

// MARK: - Offline

/// Full-screen native offline state, shown instead of a WebKit error page.
final class DawayaOfflineView: UIView {
    var onRetry: (() -> Void)?
    var onContinueOffline: (() -> Void)?

    private let contentScrollView = UIScrollView()
    private let stack = UIStackView()
    private let iconRow = UIView()
    private let iconContainer = UIView()
    private let iconView = UIImageView(image: UIImage(systemName: "wifi.slash"))
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let footnoteLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private let continueButton = UIButton(type: .system)
    private let statusLabel = UILabel()

    private var theme = DawayaTheme(isDark: false, language: .english)
    private var isBusy = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        setUp()
    }

    required init?(coder: NSCoder) {
        fatalError("Use init(frame:)")
    }

    private func setUp() {
        translatesAutoresizingMaskIntoConstraints = false
        accessibilityViewIsModal = true

        contentScrollView.translatesAutoresizingMaskIntoConstraints = false
        contentScrollView.alwaysBounceVertical = false
        contentScrollView.showsVerticalScrollIndicator = false
        addSubview(contentScrollView)

        iconRow.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.layer.cornerRadius = 40
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.contentMode = .scaleAspectFit
        iconContainer.addSubview(iconView)
        iconRow.addSubview(iconContainer)

        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.accessibilityTraits = .header

        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        messageLabel.adjustsFontForContentSizeCategory = true

        footnoteLabel.textAlignment = .center
        footnoteLabel.numberOfLines = 0
        footnoteLabel.adjustsFontForContentSizeCategory = true

        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.isHidden = true
        statusLabel.adjustsFontForContentSizeCategory = true

        configureButtonChrome()
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        continueButton.addTarget(self, action: #selector(continueTapped), for: .touchUpInside)
        retryButton.heightAnchor.constraint(equalToConstant: 50).isActive = true
        continueButton.heightAnchor.constraint(equalToConstant: 46).isActive = true

        let buttons = UIStackView(arrangedSubviews: [retryButton, continueButton])
        buttons.axis = .vertical
        buttons.spacing = 10

        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .fill
        stack.addArrangedSubview(iconRow)
        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(messageLabel)
        stack.addArrangedSubview(footnoteLabel)
        stack.addArrangedSubview(buttons)
        stack.addArrangedSubview(statusLabel)
        stack.setCustomSpacing(24, after: iconRow)
        stack.setCustomSpacing(10, after: titleLabel)
        stack.setCustomSpacing(8, after: messageLabel)
        stack.setCustomSpacing(26, after: footnoteLabel)
        stack.setCustomSpacing(16, after: buttons)
        contentScrollView.addSubview(stack)

        let center = stack.centerYAnchor.constraint(equalTo: contentScrollView.frameLayoutGuide.centerYAnchor, constant: -8)
        center.priority = .defaultHigh

        NSLayoutConstraint.activate([
            contentScrollView.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
            contentScrollView.leadingAnchor.constraint(equalTo: leadingAnchor),
            contentScrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            contentScrollView.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),

            iconRow.heightAnchor.constraint(equalToConstant: 80),
            iconContainer.centerXAnchor.constraint(equalTo: iconRow.centerXAnchor),
            iconContainer.centerYAnchor.constraint(equalTo: iconRow.centerYAnchor),
            iconContainer.widthAnchor.constraint(equalToConstant: 80),
            iconContainer.heightAnchor.constraint(equalToConstant: 80),
            iconView.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 32),
            iconView.heightAnchor.constraint(equalToConstant: 32),

            stack.topAnchor.constraint(greaterThanOrEqualTo: contentScrollView.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: contentScrollView.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.centerXAnchor.constraint(equalTo: contentScrollView.frameLayoutGuide.centerXAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: contentScrollView.frameLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: contentScrollView.frameLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 440),
            center
        ])

        // Preferred width for tablets, while still leaving breathing room on phones.
        let preferredWidth = stack.widthAnchor.constraint(equalTo: contentScrollView.frameLayoutGuide.widthAnchor, constant: -48)
        preferredWidth.priority = .defaultHigh
        preferredWidth.isActive = true

        apply(theme: theme)
    }

    private func configureButtonChrome() {
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        continueButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.titleLabel?.adjustsFontForContentSizeCategory = true
        continueButton.titleLabel?.adjustsFontForContentSizeCategory = true
    }

    func apply(theme: DawayaTheme) {
        self.theme = theme
        backgroundColor = theme.background
        semanticContentAttribute = theme.semanticDirection
        stack.semanticContentAttribute = theme.semanticDirection

        iconContainer.backgroundColor = theme.accentSoft
        iconView.tintColor = theme.accent

        titleLabel.font = theme.displayFont(size: 28, weight: .bold)
        titleLabel.textColor = theme.primaryText
        titleLabel.text = theme.strings.offlineTitle

        messageLabel.font = .systemFont(ofSize: 15.5, weight: .regular)
        messageLabel.textColor = theme.secondaryText
        messageLabel.text = theme.strings.offlineMessage

        footnoteLabel.font = .systemFont(ofSize: 13, weight: .regular)
        footnoteLabel.textColor = theme.tertiaryText
        footnoteLabel.text = theme.strings.offlineFootnote

        statusLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        statusLabel.textColor = theme.danger
        if !statusLabel.isHidden {
            statusLabel.text = theme.strings.stillOffline
        }

        applyButtonConfigurations()
    }

    private func applyButtonConfigurations() {
        var primary = UIButton.Configuration.filled()
        primary.title = isBusy ? theme.strings.retrying : theme.strings.retry
        primary.showsActivityIndicator = isBusy
        primary.baseBackgroundColor = theme.accentStrong
        primary.baseForegroundColor = theme.onAccent
        primary.background.cornerRadius = 14
        primary.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 20, bottom: 13, trailing: 20)
        primary.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
            return outgoing
        }
        retryButton.configuration = primary
        retryButton.isEnabled = !isBusy

        var secondary = UIButton.Configuration.bordered()
        secondary.title = theme.strings.continueOffline
        secondary.baseForegroundColor = theme.primaryText
        secondary.background.backgroundColor = .clear
        secondary.background.strokeColor = theme.separator
        secondary.background.strokeWidth = 1
        secondary.background.cornerRadius = 14
        secondary.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 20, bottom: 11, trailing: 20)
        secondary.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.systemFont(ofSize: 15.5, weight: .medium)
            return outgoing
        }
        continueButton.configuration = secondary
        continueButton.isEnabled = !isBusy
    }

    func setBusy(_ busy: Bool) {
        guard isBusy != busy else { return }
        isBusy = busy
        if busy {
            statusLabel.isHidden = true
        }
        applyButtonConfigurations()
    }

    func showStillOffline() {
        statusLabel.text = theme.strings.stillOffline
        statusLabel.isHidden = false
        UIAccessibility.post(notification: .announcement, argument: theme.strings.stillOffline)
    }

    @objc private func retryTapped() {
        guard !isBusy else { return }
        onRetry?()
    }

    @objc private func continueTapped() {
        guard !isBusy else { return }
        onContinueOffline?()
    }
}

// MARK: - Toast

/// Small status banner used for downloads and offline-mode notices.
final class DawayaToastView: UIView {
    enum Style {
        case progress
        case success
        case failure
        case info
    }

    private let card = UIView()
    private let contentStack = UIStackView()
    private let iconView = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()
    private var hideWorkItem: DispatchWorkItem?
    private var theme = DawayaTheme(isDark: false, language: .english)

    override init(frame: CGRect) {
        super.init(frame: frame)
        setUp()
    }

    required init?(coder: NSCoder) {
        fatalError("Use init(frame:)")
    }

    private func setUp() {
        translatesAutoresizingMaskIntoConstraints = false
        isUserInteractionEnabled = false
        isHidden = true
        alpha = 0

        card.translatesAutoresizingMaskIntoConstraints = false
        card.layer.cornerRadius = 16
        card.layer.cornerCurve = .continuous
        card.layer.borderWidth = 1
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.18
        card.layer.shadowRadius = 18
        card.layer.shadowOffset = CGSize(width: 0, height: 8)
        addSubview(card)

        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.contentMode = .scaleAspectFit
        iconView.isHidden = true
        iconView.widthAnchor.constraint(equalToConstant: 20).isActive = true
        iconView.heightAnchor.constraint(equalToConstant: 20).isActive = true

        spinner.hidesWhenStopped = true
        spinner.widthAnchor.constraint(equalToConstant: 20).isActive = true

        label.numberOfLines = 0
        label.adjustsFontForContentSizeCategory = true

        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentStack.axis = .horizontal
        contentStack.alignment = .center
        contentStack.spacing = 10
        contentStack.addArrangedSubview(spinner)
        contentStack.addArrangedSubview(iconView)
        contentStack.addArrangedSubview(label)
        card.addSubview(contentStack)

        let preferredWidth = card.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor)
        preferredWidth.priority = .required
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: topAnchor),
            card.bottomAnchor.constraint(equalTo: bottomAnchor),
            card.centerXAnchor.constraint(equalTo: centerXAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor),
            card.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
            preferredWidth,

            contentStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 13),
            contentStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -13),
            contentStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16)
        ])

        apply(theme: theme)
    }

    func apply(theme: DawayaTheme) {
        self.theme = theme
        card.backgroundColor = theme.isDark ? theme.surfaceSoft : theme.surface
        card.layer.borderColor = theme.separator.cgColor
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.textColor = theme.primaryText
        spinner.color = theme.accent
        contentStack.semanticContentAttribute = theme.semanticDirection
        label.textAlignment = .natural
    }

    func show(_ message: String, style: Style, autoHideAfter: TimeInterval? = nil) {
        hideWorkItem?.cancel()
        hideWorkItem = nil

        label.text = message
        spinner.stopAnimating()
        spinner.isHidden = true
        iconView.isHidden = false

        switch style {
        case .progress:
            iconView.isHidden = true
            spinner.isHidden = false
            spinner.startAnimating()
        case .success:
            iconView.image = UIImage(systemName: "checkmark.circle.fill")
            iconView.tintColor = theme.success
        case .failure:
            iconView.image = UIImage(systemName: "exclamationmark.triangle.fill")
            iconView.tintColor = theme.danger
        case .info:
            iconView.image = UIImage(systemName: "info.circle.fill")
            iconView.tintColor = theme.accent
        }

        isHidden = false
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.alpha = 1
        }

        if let delay = autoHideAfter {
            let work = DispatchWorkItem { [weak self] in self?.hide() }
            hideWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }

    func hide() {
        hideWorkItem?.cancel()
        hideWorkItem = nil
        spinner.stopAnimating()
        UIView.animate(withDuration: 0.2, animations: {
            self.alpha = 0
        }, completion: { _ in
            self.isHidden = true
        })
    }
}
