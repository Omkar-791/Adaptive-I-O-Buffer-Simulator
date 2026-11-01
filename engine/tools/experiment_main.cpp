#include "ExperimentRunner.h"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <algorithm>
namespace {
size_t integer(const std::string& value) {
    if(value.empty()||!std::all_of(value.begin(),value.end(),[](char c){return c>='0'&&c<='9';}))
        throw std::invalid_argument("Expected a nonnegative integer");
    const auto result=std::stoull(value);
    if(result>std::numeric_limits<size_t>::max()) throw std::out_of_range("Integer exceeds size_t");
    return static_cast<size_t>(result);
}
}
int main(int argc,char** argv) {
    try {
        std::string config_path,name,strategy_name="fixed_equal";
        ExperimentRunOptions options;
        std::optional<size_t> budget;
        size_t minimum=1,maximum=64;
        for(int i=1;i<argc;++i) {
            const std::string arg=argv[i];
            if(arg=="--help"||arg=="-h") {
                std::cout<<"Usage: experiment_runner --config <path> [--strategy fixed_equal|adaptive] [--seed n] [--repetition n] [--budget n] [--requests n] [--min-capacity n] [--max-capacity n] [--metrics-interval-ms n] [--metrics-window-ms n] [--name text]\n";
                return 0;
            }
            if(++i>=argc) throw std::invalid_argument("Missing value for "+arg);
            const std::string value=argv[i];
            if(arg=="--config") config_path=value;
            else if(arg=="--name") name=value;
            else if(arg=="--strategy") strategy_name=value;
            else if(arg=="--seed") {
                const auto seed=integer(value);
                if(seed>std::numeric_limits<uint32_t>::max()) throw std::invalid_argument("Seed exceeds uint32 range");
                options.seed=static_cast<uint32_t>(seed);
            }
            else if(arg=="--repetition") options.repetition=integer(value);
            else if(arg=="--budget") budget=integer(value);
            else if(arg=="--requests") options.request_count=integer(value);
            else if(arg=="--min-capacity") minimum=integer(value);
            else if(arg=="--max-capacity") maximum=integer(value);
            else if(arg=="--metrics-interval-ms") options.metrics.interval_ms=integer(value);
            else if(arg=="--metrics-window-ms") options.metrics.window_ms=integer(value);
            else throw std::invalid_argument("Unknown option "+arg);
        }
        if(config_path.empty()) throw std::invalid_argument("--config is required");
        AllocationStrategy strategy;
        if(strategy_name=="fixed_equal") strategy=AllocationStrategy::FixedEqual;
        else if(strategy_name=="adaptive") strategy=AllocationStrategy::Adaptive;
        else throw std::invalid_argument("Strategy must be fixed_equal or adaptive");
        const auto experiment=ExperimentRunner::makeCase(ConfigParser::parseFile(config_path),name.empty()?config_path:name,budget,minimum,maximum);
        const auto result=ExperimentRunner::runOne(experiment,strategy,options);
        std::cout<<result.toJson()<<'\n';
        return result.success?0:1;
    } catch(const std::exception& error) {std::cerr<<"Experiment error: "<<error.what()<<'\n';return 2;}
}
