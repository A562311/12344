"""
HTTP CONNECT 代理助手 —— 给 SSH 的 ProxyCommand 用

用法:
    python ssh_proxy.py <proxy_host> <proxy_port> <target_host> <target_port>

原理:
  1. 连上 HTTP 代理
  2. 发 CONNECT 请求建隧道
  3. 两个线程双向转发: stdin->socket, socket->stdout

零依赖,只用标准库。
"""
import os
import socket
import sys
import threading

# Windows: stdout/stdin 必须是二进制模式,否则会破坏 SSH 数据流
try:
    import msvcrt
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
except (ImportError, AttributeError, OSError):
    pass

STOP = threading.Event()


def pump_in(sock):
    """stdin -> socket"""
    fd = sys.stdin.fileno()
    try:
        while not STOP.is_set():
            data = os.read(fd, 65536)
            if not data:
                break
            sock.sendall(data)
    except (OSError, ValueError):
        pass
    finally:
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        STOP.set()


def pump_out(sock):
    """socket -> stdout"""
    fd = sys.stdout.fileno()
    try:
        while not STOP.is_set():
            data = sock.recv(65536)
            if not data:
                break
            os.write(fd, data)
    except (OSError, ValueError):
        pass
    finally:
        STOP.set()


def main():
    if len(sys.argv) < 5:
        print(f"usage: {sys.argv[0]} proxy_host proxy_port target_host target_port",
              file=sys.stderr)
        return 2

    proxy_host, proxy_port, target_host, target_port = (
        sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
    )

    try:
        sock = socket.create_connection((proxy_host, proxy_port), timeout=20)
    except Exception as e:
        print(f"proxy connect failed: {e}", file=sys.stderr)
        return 1

    try:
        req = (
            f"CONNECT {target_host}:{target_port} HTTP/1.1\r\n"
            f"Host: {target_host}:{target_port}\r\n"
            "User-Agent: curl/8.0\r\n"
            "\r\n"
        )
        sock.sendall(req.encode())

        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                print("proxy closed before response", file=sys.stderr)
                return 1
            buf += chunk
            if len(buf) > 65536:
                print("proxy response too large", file=sys.stderr)
                return 1

        header, _, _rest = buf.partition(b"\r\n\r\n")
        status_line = header.split(b"\r\n")[0].decode(errors="replace")
        if " 200" not in status_line:
            print(f"proxy refused: {status_line}", file=sys.stderr)
            return 1

        # 隧道已建立,开始双向转发
        t_in = threading.Thread(target=pump_in, args=(sock,), daemon=True)
        t_out = threading.Thread(target=pump_out, args=(sock,), daemon=True)
        t_in.start()
        t_out.start()

        # 等任一方向结束
        while not STOP.is_set():
            STOP.wait(0.5)

    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        try:
            sock.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
