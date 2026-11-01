#ifndef ADAPTIVE_IO_WORKLOAD_FINGERPRINT_H
#define ADAPTIVE_IO_WORKLOAD_FINGERPRINT_H
#include "WorkloadGenerator.h"
#include <cstdint>
constexpr uint64_t WORKLOAD_FINGERPRINT_OFFSET=14695981039346656037ULL;
inline void fingerprintInteger(uint64_t& hash,uint64_t value) {
    for(unsigned byte=0;byte<8;++byte) { hash^=(value&255U);hash*=1099511628211ULL;value>>=8; }
}
inline void updateWorkloadFingerprint(uint64_t& hash,const WorkloadRequest& request) {
    fingerprintInteger(hash,request.request_id);
    fingerprintInteger(hash,request.payload_bytes);
    fingerprintInteger(hash,request.inter_arrival_ms);
    fingerprintInteger(hash,request.phase_name.size());
    for(unsigned char byte:request.phase_name) {hash^=byte;hash*=1099511628211ULL;}
}
#endif
