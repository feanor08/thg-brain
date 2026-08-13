#!/usr/bin/env bash

set -uo pipefail

AUDIT_VERSION="1"
HOST="$(hostname -s 2>/dev/null || hostname)"
OUTPUT="${1:-/tmp/thg-node-audit-${HOST}.md}"

LOCAL_TIME="$(date --iso-8601=seconds 2>/dev/null || date)"
UTC_TIME="$(date -u --iso-8601=seconds 2>/dev/null || date -u)"
RUN_AS="${SUDO_USER:-${USER:-unknown}}"

have() {
    command -v "$1" >/dev/null 2>&1
}

heading() {
    printf '\n## %s\n\n' "$1" >> "$OUTPUT"
}

subheading() {
    printf '\n### %s\n\n' "$1" >> "$OUTPUT"
}

run() {
    local title="$1"
    shift

    printf '### %s\n\n' "$title" >> "$OUTPUT"
    printf '```text\n' >> "$OUTPUT"

    "$@" >> "$OUTPUT" 2>&1 || true

    printf '```\n\n' >> "$OUTPUT"
}

run_shell() {
    local title="$1"
    shift
    local command="$*"

    printf '### %s\n\n' "$title" >> "$OUTPUT"
    printf '```text\n' >> "$OUTPUT"

    bash -c "$command" >> "$OUTPUT" 2>&1 || true

    printf '```\n\n' >> "$OUTPUT"
}

{
    cat <<EOF
---
type: thg-node-audit
audit_version: ${AUDIT_VERSION}
hostname: ${HOST}
captured_at_local: ${LOCAL_TIME}
captured_at_utc: ${UTC_TIME}
captured_by: ${RUN_AS}
source: live-node-observation
---

# THG Node Audit — ${HOST}

This report was generated directly from the live node.

It intentionally excludes secrets, environment variables, SSH key material,
configuration file contents, Kubernetes Secrets, and process command lines.

EOF
} > "$OUTPUT"

heading "Identity"

run "Hostname" hostnamectl
run "Operating system" bash -c 'cat /etc/os-release 2>/dev/null || true'
run "Kernel" uname -a
run "Architecture" uname -m
run "Uptime" uptime
run "Timezone" timedatectl

heading "Hardware"

if have lscpu; then
    run "CPU" lscpu
fi

if have free; then
    run "Memory" free -h
fi

if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
    run_shell "CPU temperature" '
        value=$(cat /sys/class/thermal/thermal_zone0/temp)
        awk -v value="$value" "BEGIN { printf \"%.1f C\n\", value / 1000 }"
    '
fi

heading "Network"

if have ip; then
    run "Interfaces" ip -brief address
    run "Routes" ip route
fi

if have tailscale; then
    run "Tailscale IPv4" tailscale ip -4
    run "Tailscale IPv6" tailscale ip -6
    run "Tailscale version" tailscale version
fi

if have ss; then
    run "Listening TCP and UDP sockets" ss -lntup
fi

heading "Storage"

if have lsblk; then
    run "Block devices" \
        lsblk -o NAME,SIZE,TYPE,FSTYPE,FSVER,MOUNTPOINTS,MODEL
fi

if have df; then
    run "Mounted filesystem usage" df -hT
fi

if have findmnt; then
    run "Mount tree" findmnt

    run_shell "Network mounts" '
        findmnt -t nfs,nfs4,cifs 2>/dev/null || true
    '
fi

if have exportfs; then
    run "NFS exports" exportfs -v
fi

heading "Docker"

if have docker; then
    run "Docker version" docker version

    run "Docker containers" \
        docker ps -a \
        --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

    run "Docker Compose projects" docker compose ls -a

    run "Docker networks" docker network ls
    run "Docker volumes" docker volume ls

    subheading "Docker container details"

    while IFS= read -r container_id; do
        [[ -z "$container_id" ]] && continue

        NAME="$(docker inspect --format '{{.Name}}' "$container_id" 2>/dev/null | sed 's#^/##')"

        printf '#### %s\n\n' "${NAME:-unknown}" >> "$OUTPUT"

        printf '```text\n' >> "$OUTPUT"

        docker inspect \
            --format \
'Image: {{.Config.Image}}
Status: {{.State.Status}}
Started: {{.State.StartedAt}}
Restart policy: {{.HostConfig.RestartPolicy.Name}}

Ports:
{{range $port, $bindings := .NetworkSettings.Ports}}  {{$port}} -> {{range $bindings}}{{.HostIp}}:{{.HostPort}} {{end}}
{{end}}
Mounts:
{{range .Mounts}}  {{.Type}}: {{.Source}} -> {{.Destination}} (RW={{.RW}})
{{end}}
Networks:
{{range $name, $network := .NetworkSettings.Networks}}  {{$name}}: {{$network.IPAddress}}
{{end}}' \
            "$container_id" >> "$OUTPUT" 2>&1 || true

        printf '```\n\n' >> "$OUTPUT"

    done < <(docker ps -aq 2>/dev/null)
else
    printf 'Docker is not installed or not available.\n\n' >> "$OUTPUT"
fi

heading "systemd"

if have systemctl; then
    run "Running services" \
        systemctl list-units \
        --type=service \
        --state=running \
        --no-pager \
        --no-legend

    run "Failed services" \
        systemctl --failed \
        --no-pager

    run "System timers" \
        systemctl list-timers \
        --all \
        --no-pager

    run_shell "k3s service state" '
        for service in k3s k3s-agent; do
            printf "%-12s enabled=%-10s active=%s\n" \
                "$service" \
                "$(systemctl is-enabled "$service" 2>/dev/null || echo absent)" \
                "$(systemctl is-active "$service" 2>/dev/null || echo absent)"
        done
    '
fi

heading "Kubernetes / k3s"

if have k3s; then
    run "k3s version" k3s --version
fi

if have kubectl; then
    if kubectl get nodes >/dev/null 2>&1; then
        run "Kubernetes nodes" kubectl get nodes -o wide

        run "Kubernetes workloads" \
            kubectl get deployment,statefulset,daemonset -A -o wide

        run "Kubernetes pods" \
            kubectl get pods -A -o wide

        run "Kubernetes services" \
            kubectl get svc -A -o wide

        run "Kubernetes ingresses" \
            kubectl get ingress -A -o wide

        run "Kubernetes EndpointSlices" \
            kubectl get endpointslice -A -o wide

        run "Kubernetes persistent volumes" \
            kubectl get pv

        run "Kubernetes persistent volume claims" \
            kubectl get pvc -A
    else
        printf 'kubectl exists, but this node does not have usable cluster credentials.\n\n' >> "$OUTPUT"
    fi
else
    printf 'kubectl is not installed or is not in PATH.\n\n' >> "$OUTPUT"
fi

heading "Other service managers"

if have pm2; then
    run "PM2 processes" pm2 list
fi

if have supervisorctl; then
    run "Supervisor processes" supervisorctl status
fi

if have snap; then
    run "Snap services" snap services
fi

if have incus; then
    run "Incus instances" incus list
fi

if have lxc; then
    run "LXC instances" lxc list
fi

if have virsh; then
    run "libvirt virtual machines" virsh list --all
fi

heading "Firewall"

if have ufw; then
    run "UFW status" ufw status verbose
fi

heading "Application roots"

run_shell "/opt directories" '
    if [[ -d /opt ]]; then
        find /opt \
            -mindepth 1 \
            -maxdepth 2 \
            -type d \
            -printf "%p\n" \
            2>/dev/null | sort
    fi
'

run_shell "/srv directories" '
    if [[ -d /srv ]]; then
        find /srv \
            -mindepth 1 \
            -maxdepth 2 \
            -type d \
            -printf "%p\n" \
            2>/dev/null | sort
    fi
'

run_shell "/var/www directories" '
    if [[ -d /var/www ]]; then
        find /var/www \
            -mindepth 1 \
            -maxdepth 2 \
            -type d \
            -printf "%p\n" \
            2>/dev/null | sort
    fi
'

heading "Audit metadata"

{
    printf '```text\n'
    printf 'Audit version: %s\n' "$AUDIT_VERSION"
    printf 'Hostname: %s\n' "$HOST"
    printf 'Captured local: %s\n' "$LOCAL_TIME"
    printf 'Captured UTC: %s\n' "$UTC_TIME"
    printf 'Report: %s\n' "$OUTPUT"
    printf '```\n'
} >> "$OUTPUT"

chmod 0644 "$OUTPUT" 2>/dev/null || true

echo
echo "THG node audit complete"
echo "Host:   $HOST"
echo "Report: $OUTPUT"

if have sha256sum; then
    echo -n "SHA256: "
    sha256sum "$OUTPUT" | awk '{print $1}'
fi