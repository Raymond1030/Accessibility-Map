import java.lang.reflect.InvocationTargetException;
import java.util.Arrays;

/** Java 17 source launcher: EOF from the owning Node process requests a clean JVM shutdown. */
public class EngineHost {
    public static void main(String[] args) throws Throwable {
        if (args.length == 0) throw new IllegalArgumentException("Application main class is required");
        Thread owner = new Thread(() -> {
            try {
                while (System.in.read() != -1) { /* only EOF terminates the service */ }
            } catch (java.io.IOException ignored) { /* a broken owner pipe also means stop */ }
            System.exit(0); // Runs Jetty/GraphHopper shutdown hooks and closes GTFS MapDB files.
        }, "local-engine-owner");
        owner.setDaemon(true);
        owner.start();
        try {
            Class.forName(args[0]).getMethod("main", String[].class)
                .invoke(null, (Object) Arrays.copyOfRange(args, 1, args.length));
        } catch (InvocationTargetException error) {
            throw error.getCause();
        }
    }
}
