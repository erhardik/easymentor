import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import {
  getCalls,
  getRetryList,
  getWeeks,
  login,
  logout,
  markMessage,
  saveCall,
  setApiBaseUrl,
} from "./src/api";
import { DEFAULT_API_BASE_URL, MENTOR_PASSWORD } from "./src/constants";

const talkedOptions = ["father", "mother", "guardian"];
const SESSION_KEY = "easymentor_session_v1";
const WEEK_KEY = "easymentor_week_v1";
const RETRY_COUNT_KEY = "easymentor_retry_count_v1";
const SERVER_URL_KEY = "easymentor_server_url_v1";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureNotificationPermission() {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.status === "granted") {
    return true;
  }
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

async function configureNotificationChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0f5e9c",
    });
  }
}

function normalizeServerUrl(url) {
  const clean = (url || "").trim().replace(/\/+$/, "");
  if (!clean) {
    return "";
  }
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }
  return `http://${clean}`;
}

export default function App() {
  const [token, setToken] = useState("");
  const [mentorNameInput, setMentorNameInput] = useState("");
  const [mentorName, setMentorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [records, setRecords] = useState([]);
  const [allDone, setAllDone] = useState(false);
  const [retryRecords, setRetryRecords] = useState([]);

  const [serverUrl, setServerUrl] = useState(DEFAULT_API_BASE_URL);
  const [serverInput, setServerInput] = useState(DEFAULT_API_BASE_URL);
  const [serverModalVisible, setServerModalVisible] = useState(false);

  const [activeCall, setActiveCall] = useState(null);
  const [callStart, setCallStart] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [talked, setTalked] = useState("father");
  const [duration, setDuration] = useState("");
  const [remark, setRemark] = useState("");

  const appState = useRef(AppState.currentState);
  const pollRef = useRef(null);

  const completedCount = useMemo(
    () => records.filter((x) => x.final_status).length,
    [records]
  );

  async function storeSession(nextToken, nextMentorName) {
    await AsyncStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: nextToken, mentorName: nextMentorName })
    );
  }

  async function clearSession() {
    await AsyncStorage.multiRemove([SESSION_KEY, WEEK_KEY, RETRY_COUNT_KEY]);
  }

  async function storeSelectedWeek(week) {
    if (!week) {
      await AsyncStorage.removeItem(WEEK_KEY);
      return;
    }
    await AsyncStorage.setItem(WEEK_KEY, String(week));
  }

  async function maybeNotifyRetryPending(week, currentRetryCount) {
    const prevRaw = await AsyncStorage.getItem(RETRY_COUNT_KEY);
    const prevCount = Number(prevRaw || 0);
    await AsyncStorage.setItem(RETRY_COUNT_KEY, String(currentRetryCount));

    if (currentRetryCount <= 0 || currentRetryCount <= prevCount) {
      return;
    }
    const allowed = await ensureNotificationPermission();
    if (!allowed) {
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Retry Calls Pending",
        body: `Week ${week}: ${currentRetryCount} parents need retry calls.`,
      },
      trigger: null,
    });
  }

  async function doLogin() {
    if (!mentorNameInput.trim()) {
      Alert.alert("Mentor name is required");
      return;
    }
    setLoading(true);
    try {
      const data = await login(mentorNameInput.trim(), MENTOR_PASSWORD);
      setToken(data.token);
      setMentorName(data.mentor);
      await storeSession(data.token, data.mentor);
    } catch (err) {
      Alert.alert("Login failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard(authToken, preferredWeek = null, notifyIfNeeded = false) {
    const weekData = await getWeeks(authToken);
    const allWeeks = weekData.weeks || [];
    const chosenWeek = preferredWeek || weekData.latest_week;
    setWeeks(allWeeks);
    setSelectedWeek(chosenWeek);
    await storeSelectedWeek(chosenWeek);
    if (!chosenWeek) {
      setRecords([]);
      setAllDone(false);
      setRetryRecords([]);
      await AsyncStorage.setItem(RETRY_COUNT_KEY, "0");
      return;
    }
    const callData = await getCalls(authToken, chosenWeek);
    setRecords(callData.records || []);
    setAllDone(Boolean(callData.all_done));
    if (callData.all_done) {
      const retryData = await getRetryList(authToken, chosenWeek);
      const retries = retryData.records || [];
      setRetryRecords(retries);
      if (notifyIfNeeded) {
        await maybeNotifyRetryPending(chosenWeek, retries.length);
      }
    } else {
      setRetryRecords([]);
      await AsyncStorage.setItem(RETRY_COUNT_KEY, "0");
    }
  }

  async function saveServerUrl() {
    const normalized = normalizeServerUrl(serverInput);
    if (!normalized) {
      Alert.alert("Invalid URL", "Please enter a valid server URL.");
      return;
    }
    setApiBaseUrl(normalized);
    setServerUrl(normalized);
    setServerInput(normalized);
    await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
    setServerModalVisible(false);

    if (!token) {
      return;
    }
    setLoading(true);
    try {
      await loadDashboard(token, selectedWeek, false);
      Alert.alert("Updated", "Server URL saved and data refreshed.");
    } catch (err) {
      Alert.alert(
        "Server unreachable",
        "URL saved, but current session could not sync. Verify server and login again if needed."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await configureNotificationChannel();
      await ensureNotificationPermission();
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const storedServerRaw = await AsyncStorage.getItem(SERVER_URL_KEY);
        const normalizedServer = normalizeServerUrl(storedServerRaw) || DEFAULT_API_BASE_URL;
        setApiBaseUrl(normalizedServer);
        setServerUrl(normalizedServer);
        setServerInput(normalizedServer);

        const raw = await AsyncStorage.getItem(SESSION_KEY);
        const storedWeekRaw = await AsyncStorage.getItem(WEEK_KEY);
        const storedWeek = storedWeekRaw ? Number(storedWeekRaw) : null;
        if (!raw) {
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed?.token) {
          await clearSession();
          return;
        }
        setToken(parsed.token);
        setMentorName(parsed.mentorName || "");
        await loadDashboard(parsed.token, storedWeek, true);
      } catch (err) {
        await clearSession();
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!token || initializing) {
      return;
    }
    let mounted = true;
    setLoading(true);
    loadDashboard(token, selectedWeek, true)
      .catch(async () => {
        Alert.alert("Session expired", "Please login again.");
        try {
          await clearSession();
        } catch (_) {}
        if (mounted) {
          setToken("");
          setMentorName("");
          setMentorNameInput("");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [token, initializing]);

  useEffect(() => {
    if (!token || !selectedWeek) {
      return;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    pollRef.current = setInterval(() => {
      loadDashboard(token, selectedWeek, true).catch(() => {});
    }, 12000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [token, selectedWeek]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === "active" &&
        activeCall
      ) {
        const elapsedSec = Math.max(0, Math.round((Date.now() - callStart) / 1000));
        const autoMinutes = elapsedSec > 0 ? Math.max(1, Math.round(elapsedSec / 60)) : "";
        setDuration(String(autoMinutes));
        setModalVisible(true);
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [activeCall, callStart]);

  async function onSelectWeek(week) {
    setLoading(true);
    try {
      await loadDashboard(token, week, false);
    } catch (err) {
      Alert.alert("Load failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  function placeCall(record) {
    const phone = (record.student.father_mobile || record.student.mother_mobile || "").trim();
    if (!phone) {
      Alert.alert("Parent number not available");
      return;
    }
    setActiveCall(record);
    setCallStart(Date.now());
    setTalked("father");
    setDuration("");
    setRemark("");
    Linking.openURL(`tel:${phone}`);
  }

  async function submitCall(status) {
    if (!activeCall) {
      return;
    }
    setLoading(true);
    try {
      await saveCall(token, {
        id: activeCall.call_id,
        status,
        talked,
        duration,
        reason: remark,
      });
      setModalVisible(false);
      setActiveCall(null);
      await loadDashboard(token, selectedWeek, true);
    } catch (err) {
      Alert.alert("Save failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onMarkMessage(callId) {
    setLoading(true);
    try {
      await markMessage(token, callId);
      await loadDashboard(token, selectedWeek, true);
    } catch (err) {
      Alert.alert("Failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    try {
      if (token) {
        await logout(token);
      }
    } catch (_) {}
    await clearSession();
    setToken("");
    setMentorName("");
    setMentorNameInput("");
    setWeeks([]);
    setSelectedWeek(null);
    setRecords([]);
    setRetryRecords([]);
  }

  if (initializing) {
    return (
      <SafeAreaView style={styles.page}>
        <StatusBar style="dark" />
        <ActivityIndicator style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.page}>
        <StatusBar style="dark" />
        <View style={styles.loginCard}>
          <Text style={styles.title}>EasyMentor Mobile</Text>
          <Text style={styles.subtitle}>Mentor Login</Text>
          <Text style={styles.serverText}>Server: {serverUrl}</Text>
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => {
              setServerInput(serverUrl);
              setServerModalVisible(true);
            }}
          >
            <Text style={styles.outlineButtonText}>Change Server</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Mentor short name"
            value={mentorNameInput}
            onChangeText={setMentorNameInput}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={doLogin} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Please wait..." : "Login"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Welcome {mentorName}</Text>
          <Text style={styles.subtitle}>
            Calls done: {completedCount}/{records.length}
          </Text>
          <Text style={styles.serverTextSmall}>{serverUrl}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={() => {
              setServerInput(serverUrl);
              setServerModalVisible(true);
            }}
          >
            <Text style={styles.outlineButtonText}>Server</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineButton} onPress={onLogout}>
            <Text style={styles.outlineButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weeksRow}>
        {weeks.map((week) => (
          <TouchableOpacity
            key={week}
            onPress={() => onSelectWeek(week)}
            style={[styles.weekButton, selectedWeek === week && styles.weekButtonActive]}
          >
            <Text style={[styles.weekButtonText, selectedWeek === week && styles.weekButtonTextActive]}>
              Week {week}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && <ActivityIndicator style={{ marginVertical: 8 }} />}

      <FlatList
        data={records}
        keyExtractor={(item) => String(item.call_id)}
        contentContainerStyle={{ paddingBottom: 150 }}
        renderItem={({ item }) => {
          const finalStatus = item.final_status || "pending";
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {item.student.roll_no || "-"} | {item.student.name}
              </Text>
              <Text style={styles.cardMeta}>{item.student.enrollment}</Text>
              <Text style={styles.cardMeta}>
                Weekly: {item.week_percentage ?? "-"} | Overall: {item.overall_percentage ?? "-"}
              </Text>
              <Text style={styles.cardMeta}>Status: {finalStatus}</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={() => placeCall(item)}>
                <Text style={styles.primaryButtonText}>Call Parent</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No calls for selected week.</Text>}
      />

      {allDone && retryRecords.length > 0 ? (
        <View style={styles.retryBox}>
          <Text style={styles.retryTitle}>Retry List</Text>
          {retryRecords.map((r) => {
            const phone = r.father_mobile || r.mother_mobile;
            const message = `Dear Parent, your ward ${r.student_name} (Roll ${r.roll_no}) attendance is below 80%. Weekly: ${r.week_percentage}. Overall: ${r.overall_percentage}.`;
            const wa = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
            return (
              <View key={r.call_id} style={styles.retryRow}>
                <Text style={styles.retryText}>
                  {r.roll_no} {r.student_name}
                </Text>
                <View style={styles.retryActions}>
                  <TouchableOpacity
                    style={styles.smallButton}
                    onPress={() => Linking.openURL(`tel:${phone}`)}
                  >
                    <Text style={styles.smallButtonText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallButton} onPress={() => Linking.openURL(wa)}>
                    <Text style={styles.smallButtonText}>WhatsApp</Text>
                  </TouchableOpacity>
                  {!r.message_sent ? (
                    <TouchableOpacity
                      style={styles.smallButton}
                      onPress={() => onMarkMessage(r.call_id)}
                    >
                      <Text style={styles.smallButtonText}>Mark Sent</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.sentText}>Sent</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Call Result</Text>
            {activeCall ? (
              <Text style={styles.modalMeta}>
                {activeCall.student.roll_no || "-"} | {activeCall.student.name}
              </Text>
            ) : null}
            <Text style={styles.modalLabel}>Talked With</Text>
            <View style={styles.choiceRow}>
              {talkedOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.choiceButton, talked === opt && styles.choiceButtonActive]}
                  onPress={() => setTalked(opt)}
                >
                  <Text style={[styles.choiceText, talked === opt && styles.choiceTextActive]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalLabel}>Duration (minutes)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={duration}
              onChangeText={setDuration}
            />

            <Text style={styles.modalLabel}>Parent Remark</Text>
            <TextInput style={styles.input} value={remark} onChangeText={setRemark} />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => submitCall("not_received")}
              >
                <Text style={styles.secondaryButtonText}>Not Received</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={() => submitCall("received")}>
                <Text style={styles.primaryButtonText}>Received</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={serverModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setServerModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Server URL</Text>
            <Text style={styles.modalMeta}>Example: http://10.86.24.113:8000</Text>
            <TextInput
              style={styles.input}
              value={serverInput}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setServerInput}
              placeholder="http://<ip>:8000"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setServerModalVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={saveServerUrl}>
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f4f7fb",
    padding: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f3057",
  },
  subtitle: {
    color: "#3f5873",
    marginTop: 2,
  },
  serverText: {
    color: "#1b4267",
    marginTop: 10,
    marginBottom: 8,
  },
  serverTextSmall: {
    color: "#4f6a86",
    marginTop: 4,
    fontSize: 12,
  },
  loginCard: {
    marginTop: 120,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d9dfeb",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: "#0f5e9c",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#0f5e9c",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  outlineButtonText: {
    color: "#0f5e9c",
    fontWeight: "600",
  },
  weeksRow: {
    maxHeight: 46,
    marginBottom: 8,
  },
  weekButton: {
    borderWidth: 1,
    borderColor: "#b8c6da",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    backgroundColor: "#fff",
  },
  weekButtonActive: {
    backgroundColor: "#0f3057",
    borderColor: "#0f3057",
  },
  weekButtonText: {
    color: "#14334f",
    fontWeight: "600",
  },
  weekButtonTextActive: {
    color: "#fff",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#d9dfeb",
  },
  cardTitle: {
    color: "#18273d",
    fontWeight: "700",
    marginBottom: 3,
  },
  cardMeta: {
    color: "#425a77",
    marginBottom: 4,
  },
  empty: {
    color: "#4f6680",
    textAlign: "center",
    marginTop: 30,
  },
  retryBox: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    backgroundColor: "#fff6e8",
    borderWidth: 1,
    borderColor: "#edcd95",
    borderRadius: 12,
    padding: 10,
  },
  retryTitle: {
    fontWeight: "700",
    color: "#664114",
    marginBottom: 6,
  },
  retryRow: {
    borderTopWidth: 1,
    borderTopColor: "#efd9b6",
    paddingVertical: 6,
  },
  retryText: {
    color: "#4a3113",
    marginBottom: 5,
  },
  retryActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  smallButton: {
    backgroundColor: "#b8741a",
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 6,
    marginBottom: 4,
  },
  smallButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  sentText: {
    color: "#1d7f4e",
    fontWeight: "700",
  },
  modalBg: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f3057",
  },
  modalMeta: {
    color: "#3f5873",
    marginTop: 4,
    marginBottom: 10,
  },
  modalLabel: {
    color: "#2f4761",
    fontWeight: "600",
    marginTop: 4,
  },
  choiceRow: {
    flexDirection: "row",
    marginVertical: 8,
  },
  choiceButton: {
    borderWidth: 1,
    borderColor: "#b8c6da",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 8,
  },
  choiceButtonActive: {
    borderColor: "#0f5e9c",
    backgroundColor: "#e7f3ff",
  },
  choiceText: {
    color: "#2f4761",
  },
  choiceTextActive: {
    color: "#0f5e9c",
    fontWeight: "700",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  secondaryButton: {
    backgroundColor: "#a54a4a",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    minWidth: 130,
  },
  secondaryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
