import SwiftUI
import UIKit

// MARK: - Models

struct DrugDetail: Identifiable, Hashable {
    let id: UUID
    let name: String
    let classification: String
    let form: String
    let factsTitle: String
    let facts: [DrugFact]
    let warnings: [DrugWarning]
    let ingredients: [DrugIngredient]
    let dosageNote: String?
    let strings: DrugDetailStrings
    let showsAddAction: Bool
    let showsBookmark: Bool

    init(
        id: UUID = UUID(),
        name: String,
        classification: String = "",
        form: String = "",
        factsTitle: String = "Dosage",
        facts: [DrugFact] = [],
        warnings: [DrugWarning] = [],
        ingredients: [DrugIngredient] = [],
        dosageNote: String? = nil,
        strings: DrugDetailStrings = DrugDetailStrings(),
        showsAddAction: Bool = true,
        showsBookmark: Bool = true
    ) {
        self.id = id
        self.name = name
        self.classification = classification
        self.form = form
        self.factsTitle = factsTitle
        self.facts = facts
        self.warnings = warnings
        self.ingredients = ingredients
        self.dosageNote = dosageNote
        self.strings = strings
        self.showsAddAction = showsAddAction
        self.showsBookmark = showsBookmark
    }

    static let placeholder = DrugDetail(
        name: "Amoxicillin",
        classification: "Antibiotic · Penicillin",
        form: "500 mg capsule · Oral",
        facts: [
            DrugFact(icon: "clock.fill", title: "Standard dose", value: "1 capsule every 8 hours"),
            DrugFact(icon: "calendar", title: "Maximum daily", value: "1,500 mg")
        ],
        warnings: [
            DrugWarning(
                severity: .critical,
                text: "Do not use if you are allergic to penicillin or other beta-lactam antibiotics."
            ),
            DrugWarning(
                severity: .caution,
                text: "Finish the full course, even if symptoms improve after a few days."
            )
        ],
        ingredients: [
            DrugIngredient(name: "Amoxicillin", strength: "500 mg", isActive: true),
            DrugIngredient(name: "Magnesium stearate", strength: "2 mg", isActive: false),
            DrugIngredient(name: "Gelatin capsule", strength: "—", isActive: false)
        ]
    )
}

struct DrugFact: Identifiable, Hashable {
    let id = UUID()
    let icon: String
    let title: String
    let value: String
}

/// Localized copy supplied by the web layer so the native sheet follows the
/// app language without duplicating the web translation catalogue.
struct DrugDetailStrings: Hashable {
    var dosageFooter = "Your prescriber may adjust the dose for your age, weight, or kidney function."
    var warningsTitle = "Warnings"
    var warningsFooter = "Always follow your doctor's or pharmacist's instructions."
    var ingredientsTitle = "Active Ingredients"
    var activeIngredient = "Active ingredient"
    var addAction = "Add to My Medications"
    var addedAction = "Added to My Medications"
    var addHint = "Adds this drug to your personal medication list"
    var bookmark = "Bookmark drug"
    var removeBookmark = "Remove bookmark"
    var closeAction = "Done"

    init() {}

    init(payload: [String: Any]) {
        func text(_ key: String, _ fallback: String) -> String {
            guard let raw = payload[key] as? String else { return fallback }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? fallback : String(trimmed.prefix(160))
        }
        dosageFooter = text("dosageFooter", dosageFooter)
        warningsTitle = text("warningsTitle", warningsTitle)
        warningsFooter = text("warningsFooter", warningsFooter)
        ingredientsTitle = text("ingredientsTitle", ingredientsTitle)
        activeIngredient = text("activeIngredient", activeIngredient)
        addAction = text("addAction", addAction)
        addedAction = text("addedAction", addedAction)
        addHint = text("addHint", addHint)
        bookmark = text("bookmark", bookmark)
        removeBookmark = text("removeBookmark", removeBookmark)
        closeAction = text("closeAction", closeAction)
    }
}

extension DrugDetail {
    init?(payload: [String: Any]) {
        guard let name = Self.text(payload["name"]) else { return nil }
        self.init(
            name: String(name.prefix(160)),
            classification: Self.text(payload["classification"]).map { String($0.prefix(160)) } ?? "",
            form: Self.text(payload["form"]).map { String($0.prefix(160)) } ?? "",
            factsTitle: Self.text(payload["factsTitle"]).map { String($0.prefix(80)) } ?? "Dosage",
            facts: Self.facts(payload["facts"]),
            warnings: Self.warnings(payload["warnings"]),
            ingredients: Self.ingredients(payload["ingredients"]),
            dosageNote: Self.text(payload["dosageNote"]).map { String($0.prefix(600)) },
            strings: DrugDetailStrings(payload: payload["strings"] as? [String: Any] ?? [:]),
            showsAddAction: payload["showsAddAction"] as? Bool ?? true,
            showsBookmark: payload["showsBookmark"] as? Bool ?? true
        )
    }

    private static func text(_ value: Any?) -> String? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func facts(_ value: Any?) -> [DrugFact] {
        guard let rows = value as? [[String: Any]] else { return [] }
        return rows.prefix(8).compactMap { row in
            guard let title = text(row["title"]), let value = text(row["value"]) else { return nil }
            return DrugFact(
                icon: text(row["icon"]) ?? "info.circle",
                title: String(title.prefix(80)),
                value: String(value.prefix(200))
            )
        }
    }

    private static func warnings(_ value: Any?) -> [DrugWarning] {
        guard let rows = value as? [[String: Any]] else { return [] }
        return rows.prefix(6).compactMap { row in
            guard let body = text(row["text"]) else { return nil }
            let severity: DrugWarning.Severity =
                text(row["severity"])?.lowercased() == "critical" ? .critical : .caution
            return DrugWarning(severity: severity, text: String(body.prefix(1200)))
        }
    }

    private static func ingredients(_ value: Any?) -> [DrugIngredient] {
        guard let rows = value as? [[String: Any]] else { return [] }
        return rows.prefix(20).compactMap { row in
            guard let name = text(row["name"]) else { return nil }
            return DrugIngredient(
                name: String(name.prefix(120)),
                strength: String((text(row["strength"]) ?? "").prefix(80)),
                isActive: row["isActive"] as? Bool ?? false
            )
        }
    }
}

struct DrugWarning: Identifiable, Hashable {
    enum Severity: Hashable {
        case critical
        case caution

        var symbol: String {
            switch self {
            case .critical: return "exclamationmark.triangle.fill"
            case .caution: return "exclamationmark.circle.fill"
            }
        }

        var tint: Color {
            switch self {
            case .critical: return DrugPalette.critical
            case .caution: return DrugPalette.caution
            }
        }
    }

    let id = UUID()
    let severity: Severity
    let text: String
}

struct DrugIngredient: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let strength: String
    let isActive: Bool
}

// MARK: - Design tokens

private enum DrugPalette {
    static let accent = Color(.systemTeal)
    static let critical = Color(.systemRed)
    static let caution = Color(.systemOrange)
    static let success = Color(.systemGreen)
    static let groupedBackground = Color(.systemGroupedBackground)
    static let cardBackground = Color(.secondarySystemGroupedBackground)
}

private enum DrugHaptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    static func success() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }
}

// MARK: - Navigation host

/// Uses NavigationStack on iOS 16+ while keeping the project's iOS 15
/// deployment target working, with the same large-title behavior on both.
struct NativeNavigationHost<Content: View>: View {
    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        if #available(iOS 16.0, *) {
            NavigationStack(root: content)
        } else {
            NavigationView {
                content()
            }
            .navigationViewStyle(.stack)
        }
    }
}

// MARK: - Drug detail

struct DrugDetailView: View {
    let drug: DrugDetail

    @State private var isSaved = false
    @State private var isAddedToMedications = false

    var body: some View {
        List {
            Section {
                DrugSummaryHeader(drug: drug)
                    .listRowBackground(DrugPalette.cardBackground)
            }

            if !drug.facts.isEmpty {
                Section {
                    ForEach(drug.facts) { fact in
                        InfoRow(icon: fact.icon, title: fact.title, value: fact.value)
                    }
                } header: {
                    Text(drug.factsTitle)
                } footer: {
                    Text(drug.dosageNote ?? drug.strings.dosageFooter)
                }
            }

            if !drug.warnings.isEmpty {
                Section {
                    ForEach(drug.warnings) { warning in
                        WarningRow(warning: warning)
                    }
                } header: {
                    Text(drug.strings.warningsTitle)
                } footer: {
                    Text(drug.strings.warningsFooter)
                }
            }

            if !drug.ingredients.isEmpty {
                Section {
                    ForEach(drug.ingredients) { ingredient in
                        IngredientRow(
                            ingredient: ingredient,
                            activeLabel: drug.strings.activeIngredient
                        )
                    }
                } header: {
                    Text(drug.strings.ingredientsTitle)
                }
            }

            if drug.showsAddAction {
                Section {
                    Button(action: toggleMedication) {
                        Label(
                            isAddedToMedications ? drug.strings.addedAction : drug.strings.addAction,
                            systemImage: isAddedToMedications ? "checkmark.circle.fill" : "plus.circle.fill"
                        )
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(isAddedToMedications ? DrugPalette.success : DrugPalette.accent)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                    .accessibilityHint(drug.strings.addHint)
                }
            }
        }
        .listStyle(.insetGrouped)
        .environment(\.defaultMinListRowHeight, 44)
        .background(DrugPalette.groupedBackground.ignoresSafeArea())
        .navigationTitle(drug.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if drug.showsBookmark {
                    Button(action: toggleSaved) {
                        Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                            .font(.body.weight(.semibold))
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(isSaved ? drug.strings.removeBookmark : drug.strings.bookmark)
                }
            }
        }
        .tint(DrugPalette.accent)
        .dynamicTypeSize(.xSmall ... .accessibility5)
    }

    private func toggleMedication() {
        withAnimation(.easeInOut(duration: 0.2)) {
            isAddedToMedications.toggle()
        }
        if isAddedToMedications {
            DrugHaptics.success()
        } else {
            DrugHaptics.impact(.light)
        }
    }

    private func toggleSaved() {
        withAnimation(.easeInOut(duration: 0.15)) {
            isSaved.toggle()
        }
        DrugHaptics.selection()
    }
}

// MARK: - Components

private struct DrugSummaryHeader: View {
    let drug: DrugDetail

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(DrugPalette.accent.opacity(0.12))
                Image(systemName: "pill.fill")
                    .font(.title2)
                    .foregroundStyle(DrugPalette.accent)
            }
            .frame(width: 56, height: 56)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                if !drug.classification.isEmpty {
                    Text(drug.classification)
                        .font(.subheadline)
                        .foregroundStyle(Color(.secondaryLabel))
                }
                if !drug.form.isEmpty {
                    Text(drug.form)
                        .font(.footnote)
                        .foregroundStyle(Color(.tertiaryLabel))
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

private struct InfoRow: View {
    let icon: String
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon)
                .font(.footnote)
                .foregroundStyle(DrugPalette.accent)
                .frame(width: 20, alignment: .center)
                .accessibilityHidden(true)

            Text(title)
                .font(.body)
                .foregroundStyle(Color(.label))

            Spacer(minLength: 12)

            Text(value)
                .font(.subheadline)
                .foregroundStyle(Color(.secondaryLabel))
                .multilineTextAlignment(.trailing)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

private struct WarningRow: View {
    let warning: DrugWarning

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: warning.severity.symbol)
                .font(.body)
                .foregroundStyle(warning.severity.tint)
                .frame(width: 24, alignment: .center)
                .accessibilityHidden(true)

            Text(warning.text)
                .font(.subheadline)
                .foregroundStyle(Color(.label))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

private struct IngredientRow: View {
    let ingredient: DrugIngredient
    let activeLabel: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ingredient.name)
                    .font(.body)
                    .foregroundStyle(Color(.label))

                if ingredient.isActive {
                    Text(activeLabel)
                        .font(.caption)
                        .foregroundStyle(Color(.secondaryLabel))
                }
            }

            Spacer(minLength: 12)

            if !ingredient.strength.isEmpty {
                Text(ingredient.strength)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color(.secondaryLabel))
                    .multilineTextAlignment(.trailing)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Sheet presentation

struct DrugDetailSheet: View {
    let drug: DrugDetail
    let onClose: () -> Void

    var body: some View {
        NativeNavigationHost {
            DrugDetailView(drug: drug)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button(action: onClose) {
                            Text(drug.strings.closeAction)
                                .font(.body.weight(.semibold))
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel(drug.strings.closeAction)
                    }
                }
        }
    }
}

// MARK: - Previews

#if DEBUG
struct DrugDetailView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            NativeNavigationHost {
                DrugDetailView(drug: .placeholder)
            }
            .previewDisplayName("Light")

            NativeNavigationHost {
                DrugDetailView(drug: .placeholder)
            }
            .preferredColorScheme(.dark)
            .previewDisplayName("Dark")

            NativeNavigationHost {
                DrugDetailView(drug: .placeholder)
            }
            .environment(\.sizeCategory, .accessibilityExtraExtraExtraLarge)
            .previewDisplayName("Accessibility Size")

            TabView {
                NativeNavigationHost {
                    DrugDetailView(drug: .placeholder)
                }
                .tabItem {
                    Label("Medications", systemImage: "pill.fill")
                }

                NavigationView {
                    Text("Search")
                        .navigationTitle("Search")
                }
                .tabItem {
                    Label("Search", systemImage: "magnifyingglass")
                }
            }
            .previewDisplayName("Tab Bar")
        }
    }
}
#endif
