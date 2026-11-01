#include "ConfigParser.h"
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <cctype>
#include <unordered_map>
#include <utility>

namespace {

enum class JsonType { Null, Bool, Number, String, Array, Object };

struct JsonVal {
    JsonType type{JsonType::Null};
    bool bool_val{false};
    double num_val{0.0};
    std::string str_val{};
    std::vector<JsonVal> arr_val{};
    std::unordered_map<std::string, JsonVal> obj_val{};

    bool has(const std::string& key) const {
        return type == JsonType::Object && obj_val.find(key) != obj_val.end();
    }

    const JsonVal& get(const std::string& key) const {
        static const JsonVal null_val;
        if (type != JsonType::Object) return null_val;
        auto it = obj_val.find(key);
        if (it != obj_val.end()) return it->second;
        return null_val;
    }

    std::string asString(const std::string& def = "") const {
        return (type == JsonType::String) ? str_val : def;
    }

    double asDouble(double def = 0.0) const {
        return (type == JsonType::Number) ? num_val : def;
    }

    size_t asSizeT(size_t def = 0) const {
        return (type == JsonType::Number) ? static_cast<size_t>(num_val) : def;
    }

    uint32_t asUint32(uint32_t def = 0) const {
        return (type == JsonType::Number) ? static_cast<uint32_t>(num_val) : def;
    }

    bool asBool(bool def = false) const {
        return (type == JsonType::Bool) ? bool_val : def;
    }
};

class JsonParser {
public:
    explicit JsonParser(const std::string& src) : src_(src), pos_(0), len_(src.size()) {}

    JsonVal parse() {
        skipWhitespace();
        if (pos_ >= len_) {
            throw std::runtime_error("Empty JSON source");
        }
        JsonVal val = parseValue();
        skipWhitespace();
        return val;
    }

private:
    const std::string& src_;
    size_t pos_;
    size_t len_;

    void skipWhitespace() {
        while (pos_ < len_) {
            char c = src_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos_;
            } else if (c == '/' && pos_ + 1 < len_ && src_[pos_ + 1] == '/') {
                // Single line comment support
                pos_ += 2;
                while (pos_ < len_ && src_[pos_] != '\n') {
                    ++pos_;
                }
            } else {
                break;
            }
        }
    }

    JsonVal parseValue() {
        skipWhitespace();
        if (pos_ >= len_) {
            throw std::runtime_error("Unexpected end of input while parsing JSON");
        }

        char c = src_[pos_];
        if (c == '{') {
            return parseObject();
        } else if (c == '[') {
            return parseArray();
        } else if (c == '"') {
            return parseString();
        } else if (c == 't' || c == 'f') {
            return parseBool();
        } else if (c == 'n') {
            return parseNull();
        } else if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) {
            return parseNumber();
        } else {
            throw std::runtime_error(std::string("Unexpected character in JSON: '") + c + "'");
        }
    }

    JsonVal parseObject() {
        JsonVal val;
        val.type = JsonType::Object;
        ++pos_; // consume '{'
        skipWhitespace();

        if (pos_ < len_ && src_[pos_] == '}') {
            ++pos_;
            return val;
        }

        while (pos_ < len_) {
            skipWhitespace();
            if (pos_ >= len_ || src_[pos_] != '"') {
                throw std::runtime_error("Expected string key in object");
            }
            std::string key = parseString().str_val;
            skipWhitespace();
            if (pos_ >= len_ || src_[pos_] != ':') {
                throw std::runtime_error("Expected ':' after key in object");
            }
            ++pos_; // consume ':'
            JsonVal child = parseValue();
            val.obj_val[key] = std::move(child);

            skipWhitespace();
            if (pos_ < len_ && src_[pos_] == '}') {
                ++pos_;
                return val;
            } else if (pos_ < len_ && src_[pos_] == ',') {
                ++pos_;
            } else {
                throw std::runtime_error("Expected ',' or '}' in object");
            }
        }
        throw std::runtime_error("Unterminated object in JSON");
    }

    JsonVal parseArray() {
        JsonVal val;
        val.type = JsonType::Array;
        ++pos_; // consume '['
        skipWhitespace();

        if (pos_ < len_ && src_[pos_] == ']') {
            ++pos_;
            return val;
        }

        while (pos_ < len_) {
            val.arr_val.push_back(parseValue());
            skipWhitespace();
            if (pos_ < len_ && src_[pos_] == ']') {
                ++pos_;
                return val;
            } else if (pos_ < len_ && src_[pos_] == ',') {
                ++pos_;
            } else {
                throw std::runtime_error("Expected ',' or ']' in array");
            }
        }
        throw std::runtime_error("Unterminated array in JSON");
    }

    JsonVal parseString() {
        JsonVal val;
        val.type = JsonType::String;
        ++pos_; // consume '"'
        std::string s;

        while (pos_ < len_) {
            char c = src_[pos_++];
            if (c == '"') {
                val.str_val = s;
                return val;
            } else if (c == '\\') {
                if (pos_ >= len_) {
                    throw std::runtime_error("Unterminated escape sequence in string");
                }
                char esc = src_[pos_++];
                switch (esc) {
                    case '"': s.push_back('"'); break;
                    case '\\': s.push_back('\\'); break;
                    case '/': s.push_back('/'); break;
                    case 'b': s.push_back('\b'); break;
                    case 'f': s.push_back('\f'); break;
                    case 'n': s.push_back('\n'); break;
                    case 'r': s.push_back('\r'); break;
                    case 't': s.push_back('\t'); break;
                    default: s.push_back(esc); break;
                }
            } else {
                s.push_back(c);
            }
        }
        throw std::runtime_error("Unterminated string literal in JSON");
    }

    JsonVal parseNumber() {
        JsonVal val;
        val.type = JsonType::Number;
        size_t start = pos_;
        if (src_[pos_] == '-') ++pos_;
        while (pos_ < len_ && std::isdigit(static_cast<unsigned char>(src_[pos_]))) {
            ++pos_;
        }
        if (pos_ < len_ && src_[pos_] == '.') {
            ++pos_;
            while (pos_ < len_ && std::isdigit(static_cast<unsigned char>(src_[pos_]))) {
                ++pos_;
            }
        }
        if (pos_ < len_ && (src_[pos_] == 'e' || src_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < len_ && (src_[pos_] == '+' || src_[pos_] == '-')) {
                ++pos_;
            }
            while (pos_ < len_ && std::isdigit(static_cast<unsigned char>(src_[pos_]))) {
                ++pos_;
            }
        }

        std::string num_str = src_.substr(start, pos_ - start);
        val.num_val = std::stod(num_str);
        return val;
    }

    JsonVal parseBool() {
        JsonVal val;
        val.type = JsonType::Bool;
        if (src_.compare(pos_, 4, "true") == 0) {
            val.bool_val = true;
            pos_ += 4;
            return val;
        } else if (src_.compare(pos_, 5, "false") == 0) {
            val.bool_val = false;
            pos_ += 5;
            return val;
        }
        throw std::runtime_error("Expected boolean literal");
    }

    JsonVal parseNull() {
        JsonVal val;
        val.type = JsonType::Null;
        if (src_.compare(pos_, 4, "null") == 0) {
            pos_ += 4;
            return val;
        }
        throw std::runtime_error("Expected null literal");
    }
};

WorkloadConfig parseWorkloadObject(const JsonVal& obj) {
    WorkloadConfig wc;
    if (obj.has("type")) {
        wc.type = stringToWorkloadType(obj.get("type").asString("STEADY"));
    }
    if (obj.has("base_interval_ms")) {
        wc.base_interval_ms = obj.get("base_interval_ms").asUint32(wc.base_interval_ms);
    }
    if (obj.has("burst_interval_ms")) {
        wc.burst_interval_ms = obj.get("burst_interval_ms").asUint32(wc.burst_interval_ms);
    }
    if (obj.has("burst_length")) {
        wc.burst_length = obj.get("burst_length").asSizeT(wc.burst_length);
    }
    if (obj.has("normal_length")) {
        wc.normal_length = obj.get("normal_length").asSizeT(wc.normal_length);
    }
    if (obj.has("period_length")) {
        wc.period_length = obj.get("period_length").asSizeT(wc.period_length);
    }
    if (obj.has("amplitude_pct")) {
        wc.amplitude_pct = obj.get("amplitude_pct").asDouble(wc.amplitude_pct);
    }
    if (obj.has("lambda")) {
        wc.lambda = obj.get("lambda").asDouble(wc.lambda);
    }
    if (obj.has("min_payload_bytes")) {
        wc.min_payload_bytes = obj.get("min_payload_bytes").asSizeT(wc.min_payload_bytes);
    }
    if (obj.has("max_payload_bytes")) {
        wc.max_payload_bytes = obj.get("max_payload_bytes").asSizeT(wc.max_payload_bytes);
    }
    if (obj.has("seed")) {
        wc.seed = obj.get("seed").asUint32(wc.seed);
    }
    if (obj.has("stream_id")) {
        wc.stream_id = obj.get("stream_id").asUint32(wc.stream_id);
    }

    if (obj.has("phases") && obj.get("phases").type == JsonType::Array) {
        for (const auto& phase_val : obj.get("phases").arr_val) {
            if (phase_val.type == JsonType::Object) {
                WorkloadPhase phase;
                phase.name = phase_val.get("name").asString("PHASE");
                phase.interval_ms = phase_val.get("interval_ms").asUint32(10);
                phase.request_count = phase_val.get("request_count").asSizeT(50);
                phase.min_payload_bytes = phase_val.get("min_payload_bytes").asSizeT(wc.min_payload_bytes);
                phase.max_payload_bytes = phase_val.get("max_payload_bytes").asSizeT(wc.max_payload_bytes);
                wc.phases.push_back(phase);
            }
        }
    }
    return wc;
}

} // anonymous namespace

ParsedSimulationConfig ConfigParser::parseFile(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        throw std::runtime_error("Could not open configuration file: " + filepath);
    }
    std::stringstream buffer;
    buffer << file.rdbuf();
    return parseString(buffer.str());
}

ParsedSimulationConfig ConfigParser::parseString(const std::string& json_str) {
    JsonParser parser(json_str);
    JsonVal root = parser.parse();

    if (root.type != JsonType::Object) {
        throw std::runtime_error("Configuration root must be a JSON object");
    }

    ParsedSimulationConfig result;

    if (root.has("global_buffer_budget")) {
        result.global_budget = root.get("global_buffer_budget").asSizeT(0);
        result.sim_config.global_buffer_budget = result.global_budget;
    }

    // Check for heterogeneous multi-stream configuration
    if (root.has("streams") && root.get("streams").type == JsonType::Array) {
        result.is_heterogeneous = true;
        const auto& streams_arr = root.get("streams").arr_val;
        uint32_t auto_id = 0;

        for (const auto& sval : streams_arr) {
            if (sval.type != JsonType::Object) continue;
            IOStreamConfig sc;
            sc.stream_id = sval.has("stream_id") ? sval.get("stream_id").asUint32(auto_id) : auto_id;
            sc.name = sval.get("name").asString("Stream-" + std::to_string(sc.stream_id));
            sc.buffer_capacity = sval.get("buffer_capacity").asSizeT(8);
            sc.num_requests = sval.get("num_requests").asSizeT(root.get("num_requests").asSizeT(1000));
            sc.producer_interval_ms = sval.get("producer_interval_ms").asUint32(5);
            sc.consumer_processing_ms = sval.get("consumer_processing_ms").asUint32(10);
            sc.min_payload_bytes = sval.get("min_payload_bytes").asSizeT(512);
            sc.max_payload_bytes = sval.get("max_payload_bytes").asSizeT(4096);
            sc.random_seed = sval.get("random_seed").asUint32(42 + auto_id * 100);

            if (sval.has("workload") && sval.get("workload").type == JsonType::Object) {
                sc.use_workload_config = true;
                sc.workload = parseWorkloadObject(sval.get("workload"));
                sc.workload.stream_id = sc.stream_id;
                if (!sval.get("workload").has("seed")) {
                    sc.workload.seed = sc.random_seed;
                }
            }

            result.stream_configs.push_back(sc);
            ++auto_id;
        }

        return result;
    }

    // Uniform simulation configuration
    result.is_heterogeneous = false;
    if (root.has("num_streams")) {
        result.sim_config.num_streams = root.get("num_streams").asSizeT(1);
    }
    if (root.has("buffer_capacity")) {
        result.sim_config.buffer_capacity = root.get("buffer_capacity").asSizeT(8);
        result.sim_config.capacity_explicitly_set = true;
    }
    if (root.has("min_buffer_capacity")) {
        result.sim_config.min_buffer_capacity = root.get("min_buffer_capacity").asSizeT(1);
    }
    if (root.has("num_requests")) {
        result.sim_config.num_requests = root.get("num_requests").asSizeT(1000);
    }
    if (root.has("producer_interval_ms")) {
        result.sim_config.producer_interval_ms = root.get("producer_interval_ms").asUint32(5);
    }
    if (root.has("consumer_processing_ms")) {
        result.sim_config.consumer_processing_ms = root.get("consumer_processing_ms").asUint32(10);
    }
    if (root.has("min_payload_bytes")) {
        result.sim_config.min_payload_bytes = root.get("min_payload_bytes").asSizeT(512);
    }
    if (root.has("max_payload_bytes")) {
        result.sim_config.max_payload_bytes = root.get("max_payload_bytes").asSizeT(4096);
    }
    if (root.has("random_seed")) {
        result.sim_config.random_seed = root.get("random_seed").asUint32(42);
    }

    if (root.has("workload") && root.get("workload").type == JsonType::Object) {
        result.sim_config.use_workload_config = true;
        result.sim_config.workload = parseWorkloadObject(root.get("workload"));
        if (!root.get("workload").has("seed")) {
            result.sim_config.workload.seed = result.sim_config.random_seed;
        }
    }

    return result;
}
