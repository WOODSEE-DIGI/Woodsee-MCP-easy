import Foundation
import MCP

/// Convenience helpers for building CallTool.Result values.

func textResult(_ text: String) -> CallTool.Result {
    CallTool.Result(content: [.text(text: text, annotations: nil, _meta: nil)])
}

func errorResult(_ message: String) -> CallTool.Result {
    CallTool.Result(
        content: [.text(text: "Error: \(message)", annotations: nil, _meta: nil)],
        isError: true
    )
}

func jsonResult(_ object: Any) -> CallTool.Result {
    if JSONSerialization.isValidJSONObject(object),
       let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
       let text = String(data: data, encoding: .utf8)
    {
        return textResult(text)
    }
    return textResult(String(describing: object))
}

/// Extract a string value from MCP Value type.
extension Value {
    var stringValue: String? {
        switch self {
        case .string(let s): return s
        default: return nil
        }
    }

    var boolValue: Bool? {
        switch self {
        case .bool(let b): return b
        case .string(let s): return s == "true"
        default: return nil
        }
    }

    var intValue: Int? {
        switch self {
        case .int(let i): return i
        case .double(let d): return Int(d)
        case .string(let s): return Int(s)
        default: return nil
        }
    }

    var arrayValue: [Value]? {
        switch self {
        case .array(let arr): return arr
        default: return nil
        }
    }
}
