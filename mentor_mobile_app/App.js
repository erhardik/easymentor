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
  StatusBar as RNStatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import {
  getCalls,
  getModules,
  getOtherCalls,
  getResultCalls,
  getResultCycles,
  getResultReport,
  getResultRetryList,
  getRetryList,
  getWeeks,
  getApiBaseUrl,
  login,
  logout,
  markMessage,
  markResultMessage,
  saveOtherCall,
  saveCall,
  saveResultCall,
  setApiBaseUrl,
} from "./src/api";
import {
  DEFAULT_API_BASE_URL,
  LIVE_API_BASE_URL,
  LOCAL_API_BASE_URL,
  MENTOR_PASSWORD,
} from "./src/constants";

const talkedOptions = ["father", "mother", "guardian", "student"];
const SESSION_KEY = "easymentor_session_v1";
const WEEK_KEY = "easymentor_week_v1";
const RETRY_COUNT_KEY = "easymentor_retry_count_v1";
const RESULT_UPLOAD_KEY = "easymentor_result_upload_v1";
const MODULE_KEY = "easymentor_module_v1";
const API_BASE_URL_KEY = "easymentor_api_base_url_v1";
const MENU_ITEMS = [
  { key: "attendance_calls", label: "Attendance calls" },
  { key: "result_calls", label: "Result calls" },
  { key: "other_calls", label: "Other calls" },
  { key: "report", label: "Report" },
];

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

function statusPriority(status) {
  if (status === "not_received") {
    return 0;
  }
  if (status === "received") {
    return 2;
  }
  return 1;
}

function orderCallRecords(items) {
  const list = [...(items || [])];
  list.sort((a, b) => {
    const p = statusPriority(a.final_status) - statusPriority(b.final_status);
    if (p !== 0) {
      return p;
    }
    const ra = Number(a?.student?.roll_no || 999999);
    const rb = Number(b?.student?.roll_no || 999999);
    return ra - rb;
  });
  return list;
}

export default function App() {
  const [token, setToken] = useState("");
  const [mentorNameInput, setMentorNameInput] = useState("");
  const [mentorName, setMentorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [apiBaseUrl, setApiBaseUrlState] = useState(DEFAULT_API_BASE_URL);
  const [weeks, setWeeks] = useState([]);
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [records, setRecords] = useState([]);
  const [allDone, setAllDone] = useState(false);
  const [retryRecords, setRetryRecords] = useState([]);
  const [resultCycles, setResultCycles] = useState([]);
  const [selectedResultUpload, setSelectedResultUpload] = useState(null);
  const [resultRecords, setResultRecords] = useState([]);
  const [otherRecords, setOtherRecords] = useState([]);
  const [resultAllDone, setResultAllDone] = useState(false);
  const [resultRetryRecords, setResultRetryRecords] = useState([]);
  const [resultReport, setResultReport] = useState("");
  const [lastCallType, setLastCallType] = useState("attendance");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("attendance_calls");

  const [activeCall, setActiveCall] = useState(null);
  const [callStart, setCallStart] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [talked, setTalked] = useState("father");
  const [duration, setDuration] = useState("");
  const [remark, setRemark] = useState("");
  const [callReason, setCallReason] = useState("");

  const appState = useRef(AppState.currentState);
  const pollRef = useRef(null);

  const completedCount = useMemo(
    () => records.filter((x) => x.final_status).length,
    [records]
  );
  const resultCompletedCount = useMemo(
    () => resultRecords.filter((x) => x.final_status).length,
    [resultRecords]
  );
  const visibleRecords = useMemo(() => {
    if (activeMenu === "result_calls") {
      return resultRecords;
    }
    if (activeMenu === "other_calls") {
      return otherRecords;
    }
    return records;
  }, [records, resultRecords, otherRecords, activeMenu]);
  const visibleCompletedCount = useMemo(
    () => visibleRecords.filter((x) => x.final_status).length,
    [visibleRecords]
  );
  const reportStats = useMemo(() => {
    const total = records.length;
    const done = completedCount;
    const received = records.filter((x) => x.final_status === "received").length;
    const notReceived = records.filter((x) => x.final_status === "not_received").length;
    const messageDone = records.filter((x) => x.message_sent).length;
    return {
      total,
      done,
      received,
      notReceived,
      pending: Math.max(0, total - done),
      messageDone,
    };
  }, [records, completedCount]);
  const resultReportStats = useMemo(() => {
    const total = resultRecords.length;
    const done = resultCompletedCount;
    const received = resultRecords.filter((x) => x.final_status === "received").length;
    const notReceived = resultRecords.filter((x) => x.final_status === "not_received").length;
    const messageDone = resultRecords.filter((x) => x.message_sent).length;
    return {
      total,
      done,
      received,
      notReceived,
      pending: Math.max(0, total - done),
      messageDone,
    };
  }, [resultRecords, resultCompletedCount]);
  const otherCompletedCount = useMemo(
    () => otherRecords.filter((x) => x.final_status).length,
    [otherRecords]
  );
  const talkedChoiceOptions = useMemo(
    () =>
      lastCallType === "other"
        ? talkedOptions
        : talkedOptions.filter((opt) => opt !== "student"),
    [lastCallType]
  );
  const selectedModuleName = useMemo(() => {
    const found = modules.find((m) => m.module_id === selectedModuleId);
    return found ? found.name : "-";
  }, [modules, selectedModuleId]);

  async function storeSession(nextToken, nextMentorName) {
    await AsyncStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: nextToken, mentorName: nextMentorName })
    );
  }

  async function clearSession() {
    await AsyncStorage.multiRemove([SESSION_KEY, WEEK_KEY, RETRY_COUNT_KEY, RESULT_UPLOAD_KEY]);
  }

  async function storeSelectedWeek(week) {
    if (!week) {
      await AsyncStorage.removeItem(WEEK_KEY);
      return;
    }
    await AsyncStorage.setItem(WEEK_KEY, String(week));
  }

  async function storeSelectedResultUpload(uploadId) {
    if (!uploadId) {
      await AsyncStorage.removeItem(RESULT_UPLOAD_KEY);
      return;
    }
    await AsyncStorage.setItem(RESULT_UPLOAD_KEY, String(uploadId));
  }

  async function storeSelectedModule(moduleId) {
    if (!moduleId) {
      await AsyncStorage.removeItem(MODULE_KEY);
      return;
    }
    await AsyncStorage.setItem(MODULE_KEY, String(moduleId));
  }

  async function storeApiBaseUrl(url) {
    const next = String(url || "").trim().replace(/\/+$/, "");
    await AsyncStorage.setItem(API_BASE_URL_KEY, next);
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

  async function loadResultDashboard(authToken, moduleId, preferredUploadId = null) {
    const cycleData = await getResultCycles(authToken, moduleId);
    const cycles = cycleData.cycles || [];
    setResultCycles(cycles);

    const chosenUpload =
      preferredUploadId || cycleData.latest_upload_id || (cycles.length ? cycles[0].upload_id : null);
    setSelectedResultUpload(chosenUpload || null);
    await storeSelectedResultUpload(chosenUpload || "");

    if (!chosenUpload) {
      setResultRecords([]);
      setResultAllDone(false);
      setResultRetryRecords([]);
      setResultReport("");
      return;
    }

    const callData = await getResultCalls(authToken, chosenUpload, moduleId);
    const ordered = orderCallRecords(callData.records || []);
    setResultRecords(ordered);
    setResultAllDone(Boolean(callData.all_done));

    const reportData = await getResultReport(authToken, chosenUpload, moduleId);
    setResultReport(reportData.report || "");

    if (callData.all_done) {
      const retryData = await getResultRetryList(authToken, chosenUpload, moduleId);
      setResultRetryRecords(retryData.records || []);
    } else {
      setResultRetryRecords([]);
    }
  }

  async function loadOtherCalls(authToken, moduleId) {
    const data = await getOtherCalls(authToken, moduleId);
    const ordered = orderCallRecords(data.records || []);
    setOtherRecords(ordered);
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
      const storedModuleRaw = await AsyncStorage.getItem(MODULE_KEY);
      const storedModule = storedModuleRaw ? Number(storedModuleRaw) : null;
      const modData = await getModules(data.token, storedModule || "");
      const moduleList = modData.modules || [];
      const pickedModule = modData.selected_module_id || (moduleList.length ? moduleList[0].module_id : null);
      setModules(moduleList);
      setSelectedModuleId(pickedModule || null);
      await storeSelectedModule(pickedModule || "");
      if (pickedModule) {
        await Promise.all([
          loadDashboard(data.token, pickedModule, null, false),
          loadResultDashboard(data.token, pickedModule, null),
          loadOtherCalls(data.token, pickedModule),
        ]);
      }
    } catch (err) {
      Alert.alert("Login failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onSelectApiBase(nextUrl) {
    const normalized = String(nextUrl || "").trim().replace(/\/+$/, "");
    setApiBaseUrl(normalized);
    setApiBaseUrlState(normalized);
    await storeApiBaseUrl(normalized);
  }

  async function loadDashboard(authToken, moduleId, preferredWeek = null, notifyIfNeeded = false) {
    const weekData = await getWeeks(authToken, moduleId);
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
    const callData = await getCalls(authToken, chosenWeek, moduleId);
    setRecords(orderCallRecords(callData.records || []));
    setAllDone(Boolean(callData.all_done));
    if (callData.all_done) {
      const retryData = await getRetryList(authToken, chosenWeek, moduleId);
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
        const storedApiBase = (await AsyncStorage.getItem(API_BASE_URL_KEY)) || DEFAULT_API_BASE_URL;
        setApiBaseUrl(storedApiBase);
        setApiBaseUrlState(storedApiBase);
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        const storedWeekRaw = await AsyncStorage.getItem(WEEK_KEY);
        const storedResultUploadRaw = await AsyncStorage.getItem(RESULT_UPLOAD_KEY);
        const storedModuleRaw = await AsyncStorage.getItem(MODULE_KEY);
        const storedWeek = storedWeekRaw ? Number(storedWeekRaw) : null;
        const storedResultUpload = storedResultUploadRaw ? Number(storedResultUploadRaw) : null;
        const storedModule = storedModuleRaw ? Number(storedModuleRaw) : null;
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
        const modData = await getModules(parsed.token, storedModule || "");
        const moduleList = modData.modules || [];
        const pickedModule = modData.selected_module_id || (moduleList.length ? moduleList[0].module_id : null);
        setModules(moduleList);
        setSelectedModuleId(pickedModule || null);
        await storeSelectedModule(pickedModule || "");
        if (pickedModule) {
          await loadDashboard(parsed.token, pickedModule, storedWeek, true);
          await loadResultDashboard(parsed.token, pickedModule, storedResultUpload);
          await loadOtherCalls(parsed.token, pickedModule);
        }
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
    if (!token || initializing || !selectedModuleId) {
      return;
    }
    let mounted = true;
    setLoading(true);
    Promise.all([
      loadDashboard(token, selectedModuleId, selectedWeek, true),
      loadResultDashboard(token, selectedModuleId, selectedResultUpload),
      loadOtherCalls(token, selectedModuleId),
    ])
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
  }, [token, initializing, selectedModuleId]);

  useEffect(() => {
    if (!token || !selectedModuleId) {
      return;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    pollRef.current = setInterval(() => {
      Promise.all([
        selectedWeek ? loadDashboard(token, selectedModuleId, selectedWeek, true) : Promise.resolve(),
        loadResultDashboard(token, selectedModuleId, selectedResultUpload),
        loadOtherCalls(token, selectedModuleId),
      ]).catch(() => {});
    }, 12000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [token, selectedModuleId, selectedWeek, selectedResultUpload]);

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
    if (!selectedModuleId) return;
    setLoading(true);
    try {
      await loadDashboard(token, selectedModuleId, week, false);
    } catch (err) {
      Alert.alert("Load failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onSelectResultUpload(uploadId) {
    if (!selectedModuleId) return;
    setLoading(true);
    try {
      await loadResultDashboard(token, selectedModuleId, uploadId);
    } catch (err) {
      Alert.alert("Load failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onSelectModule(moduleId) {
    if (!moduleId || moduleId === selectedModuleId) return;
    setLoading(true);
    try {
      setSelectedModuleId(moduleId);
      await storeSelectedModule(moduleId);
      await storeSelectedWeek("");
      await storeSelectedResultUpload("");
      setSelectedWeek(null);
      setSelectedResultUpload(null);
      await Promise.all([
        loadDashboard(token, moduleId, null, false),
        loadResultDashboard(token, moduleId, null),
        loadOtherCalls(token, moduleId),
      ]);
    } catch (err) {
      Alert.alert("Module switch failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  function placeCall(record, target = "father") {
    let phone = "";
    if (activeMenu === "other_calls" && target === "student") {
      phone = (record.student.student_mobile || "").trim();
    } else {
      phone = (record.student.father_mobile || record.student.mother_mobile || "").trim();
    }
    if (!phone) {
      Alert.alert("Number not available");
      return;
    }
    setActiveCall({ ...record, call_target: target });
    setLastCallType(activeMenu === "result_calls" ? "result" : "attendance");
    if (activeMenu === "other_calls") {
      setLastCallType("other");
    }
    setCallStart(Date.now());
    if (activeMenu === "other_calls" && target === "student") {
      setTalked("student");
    } else {
      setTalked("father");
    }
    setDuration("");
    setRemark("");
    setCallReason("");
    Linking.openURL(`tel:${phone}`);
  }

  async function submitCall(status) {
    if (!activeCall) {
      return;
    }
    if ((lastCallType === "attendance" || lastCallType === "result") && status === "received" && !remark.trim()) {
      Alert.alert("Remark required", "Please enter parent remark for received calls.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        id: activeCall.call_id,
        module_id: selectedModuleId,
        status,
        talked,
        duration,
        reason: remark,
      };
      if (lastCallType === "result") {
        await saveResultCall(token, payload);
      } else if (lastCallType === "other") {
        await saveOtherCall(token, {
          id: activeCall.call_id,
          module_id: selectedModuleId,
          status,
          talked,
          duration,
          remark,
          call_reason: callReason,
          target: activeCall.call_target || "father",
        });
      } else {
        await saveCall(token, payload);
      }
      setModalVisible(false);
      setActiveCall(null);
      setRemark("");
      setDuration("");
      setCallReason("");
      if (lastCallType === "result") {
        await loadResultDashboard(token, selectedModuleId, selectedResultUpload);
      } else if (lastCallType === "other") {
        await loadOtherCalls(token, selectedModuleId);
      } else {
        await loadDashboard(token, selectedModuleId, selectedWeek, true);
      }
    } catch (err) {
      Alert.alert("Save failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onMarkMessage(callId) {
    setLoading(true);
    try {
      await markMessage(token, callId, selectedModuleId);
      await loadDashboard(token, selectedModuleId, selectedWeek, true);
    } catch (err) {
      Alert.alert("Failed", String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function onMarkResultMessage(callId) {
    setLoading(true);
    try {
      await markResultMessage(token, callId, selectedModuleId);
      await loadResultDashboard(token, selectedModuleId, selectedResultUpload);
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
    setModules([]);
    setSelectedModuleId(null);
    setWeeks([]);
    setSelectedWeek(null);
    setRecords([]);
    setRetryRecords([]);
    setResultCycles([]);
    setSelectedResultUpload(null);
    setResultRecords([]);
    setResultRetryRecords([]);
    setResultReport("");
    setOtherRecords([]);
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
          <Text style={styles.modalLabel}>Server</Text>
          <View style={styles.choiceRow}>
            <TouchableOpacity
              style={[styles.choiceButton, apiBaseUrl === LOCAL_API_BASE_URL && styles.choiceButtonActive]}
              onPress={() => onSelectApiBase(LOCAL_API_BASE_URL)}
            >
              <Text style={[styles.choiceText, apiBaseUrl === LOCAL_API_BASE_URL && styles.choiceTextActive]}>
                Localhost
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.choiceButton, apiBaseUrl === LIVE_API_BASE_URL && styles.choiceButtonActive]}
              onPress={() => onSelectApiBase(LIVE_API_BASE_URL)}
            >
              <Text style={[styles.choiceText, apiBaseUrl === LIVE_API_BASE_URL && styles.choiceTextActive]}>
                Render Live
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.serverHint}>{getApiBaseUrl()}</Text>
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
          <Text style={styles.moduleTag}>Module: {selectedModuleName}</Text>
          {activeMenu === "report" ? (
            <Text style={styles.subtitle}>
              {lastCallType === "result"
                ? `Result ${selectedResultUpload || "-"}`
                : `Week ${selectedWeek || "-"}`}
            </Text>
          ) : (
            <Text style={styles.subtitle}>
              Calls done: {visibleCompletedCount}/{visibleRecords.length}
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(true)}>
            <Text style={styles.menuButtonText}>?</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineButton} onPress={onLogout}>
            <Text style={styles.outlineButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weeksRow}>
        {modules.map((m) => (
          <TouchableOpacity
            key={m.module_id}
            onPress={() => onSelectModule(m.module_id)}
            style={[styles.weekButton, selectedModuleId === m.module_id && styles.weekButtonActive]}
          >
            <Text style={[styles.weekButtonText, selectedModuleId === m.module_id && styles.weekButtonTextActive]}>
              {m.variant} {m.semester}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeMenu === "attendance_calls" ? (
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
      ) : null}

      {activeMenu === "result_calls" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weeksRow}>
          {resultCycles.map((cycle) => (
            <TouchableOpacity
              key={cycle.upload_id}
              onPress={() => onSelectResultUpload(cycle.upload_id)}
              style={[
                styles.weekButton,
                selectedResultUpload === cycle.upload_id && styles.weekButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.weekButtonText,
                  selectedResultUpload === cycle.upload_id && styles.weekButtonTextActive,
                ]}
              >
                {cycle.test_name}-{cycle.subject_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {loading && <ActivityIndicator style={{ marginVertical: 8 }} />}

      {activeMenu === "report" ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
          {lastCallType === "result" ? (
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>Result Call Report</Text>
              <Text style={styles.reportMeta}>Upload {selectedResultUpload || "-"}</Text>
              <Text style={styles.reportLine}>Total calls required: {resultReportStats.total}</Text>
              <Text style={styles.reportLine}>Calls done: {resultReportStats.done}</Text>
              <Text style={styles.reportLine}>Call received: {resultReportStats.received}</Text>
              <Text style={styles.reportLine}>Call not received: {resultReportStats.notReceived}</Text>
              <Text style={styles.reportLine}>Message sent: {resultReportStats.messageDone}</Text>
              <Text style={styles.reportLine}>Call not done: {resultReportStats.pending}</Text>
              {resultReport ? <Text style={styles.reportBody}>{resultReport}</Text> : null}
            </View>
          ) : lastCallType === "other" ? (
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>Other Calls Report</Text>
              <Text style={styles.reportLine}>Total calls: {otherRecords.length}</Text>
              <Text style={styles.reportLine}>Calls done: {otherCompletedCount}</Text>
              <Text style={styles.reportLine}>
                Call received: {otherRecords.filter((x) => x.final_status === "received").length}
              </Text>
              <Text style={styles.reportLine}>
                Call not received: {otherRecords.filter((x) => x.final_status === "not_received").length}
              </Text>
              <Text style={styles.reportLine}>
                Call not done: {Math.max(otherRecords.length - otherCompletedCount, 0)}
              </Text>
            </View>
          ) : (
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>Weekly Mentor Report</Text>
              <Text style={styles.reportMeta}>Week {selectedWeek || "-"}</Text>
              <Text style={styles.reportLine}>Total calls required: {reportStats.total}</Text>
              <Text style={styles.reportLine}>Calls done: {reportStats.done}</Text>
              <Text style={styles.reportLine}>Call received: {reportStats.received}</Text>
              <Text style={styles.reportLine}>Call not received: {reportStats.notReceived}</Text>
              <Text style={styles.reportLine}>Message sent: {reportStats.messageDone}</Text>
              <Text style={styles.reportLine}>Call not done: {reportStats.pending}</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={visibleRecords}
          keyExtractor={(item) => String(item.call_id)}
          contentContainerStyle={{ paddingBottom: 150 }}
          renderItem={({ item }) => {
            const finalStatus = item.final_status || "pending";
            const isReceived = finalStatus === "received";
            const isNotReceived = finalStatus === "not_received";

            let actionLabel = "Call Parent";
            let actionStyle = styles.primaryButton;
            if (isReceived) {
              actionLabel = "Call Done";
              actionStyle = styles.doneButton;
            } else if (isNotReceived) {
              actionLabel = "Call Not Received";
              actionStyle = styles.notReceivedButton;
            }

            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {item.student.roll_no || "-"} | {item.student.name}
                </Text>
                <Text style={styles.cardMeta}>{item.student.enrollment}</Text>
                {activeMenu === "attendance_calls" ? (
                  <Text style={styles.cardMeta}>
                    Weekly: {item.week_percentage ?? "-"} | Overall: {item.overall_percentage ?? "-"}
                  </Text>
                ) : activeMenu === "other_calls" ? (
                  <Text style={styles.cardMeta}>
                    Last target: {item.last_called_target || "-"} | Reason: {item.call_done_reason || "-"}
                  </Text>
                ) : (
                  <Text style={styles.cardMeta}>
                    {item.test_name} {item.subject_name} | Marks: {item.marks_current ?? "-"} | Total:{" "}
                    {item.marks_total ?? "-"}
                  </Text>
                )}
                {activeMenu === "result_calls" ? (
                  <Text style={styles.cardMeta}>Rule: {item.fail_reason || "-"}</Text>
                ) : null}
                <Text style={styles.cardMeta}>Status: {finalStatus}</Text>
                {activeMenu === "other_calls" ? (
                  <View style={styles.otherActions}>
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => placeCall(item, "student")}
                      disabled={isReceived}
                    >
                      <Text style={styles.primaryButtonText}>Call Student</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={actionStyle}
                      onPress={() => placeCall(item, "father")}
                      disabled={isReceived}
                    >
                      <Text style={styles.primaryButtonText}>Call Father</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={actionStyle}
                    onPress={() => placeCall(item)}
                    disabled={isReceived}
                  >
                    <Text style={styles.primaryButtonText}>{actionLabel}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No calls for selected menu.</Text>}
        />
      )}

      {activeMenu === "attendance_calls" && allDone && retryRecords.length > 0 ? (
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

      {activeMenu === "result_calls" && resultAllDone && resultRetryRecords.length > 0 ? (
        <View style={styles.retryBox}>
          <Text style={styles.retryTitle}>Result Retry List</Text>
          {resultRetryRecords.map((r) => {
            const phone = r.father_mobile || r.mother_mobile;
            const message = `Dear Parent, your ward ${r.student_name} (Roll ${r.roll_no}) is failed. ${r.fail_reason}.`;
            const wa = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
            return (
              <View key={r.call_id} style={styles.retryRow}>
                <Text style={styles.retryText}>
                  {r.roll_no} {r.student_name}
                </Text>
                <View style={styles.retryActions}>
                  <TouchableOpacity style={styles.smallButton} onPress={() => Linking.openURL(`tel:${phone}`)}>
                    <Text style={styles.smallButtonText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallButton} onPress={() => Linking.openURL(wa)}>
                    <Text style={styles.smallButtonText}>WhatsApp</Text>
                  </TouchableOpacity>
                  {!r.message_sent ? (
                    <TouchableOpacity style={styles.smallButton} onPress={() => onMarkResultMessage(r.call_id)}>
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
              {talkedChoiceOptions.map((opt) => (
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

            <Text style={styles.modalLabel}>
              {lastCallType === "other" ? "Parents Remark" : "Parent Remark"}
            </Text>
            <TextInput style={styles.input} value={remark} onChangeText={setRemark} />
            {lastCallType === "other" ? (
              <>
                <Text style={styles.modalLabel}>Call Done Reason</Text>
                <TextInput style={styles.input} value={callReason} onChangeText={setCallReason} />
              </>
            ) : null}

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
        visible={menuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.menuOverlay}>
          <View style={styles.menuDrawer}>
            <Text style={styles.menuTitle}>Menu</Text>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.menuItem, activeMenu === item.key && styles.menuItemActive]}
                onPress={() => {
                  setActiveMenu(item.key);
                  if (item.key === "attendance_calls") {
                    setLastCallType("attendance");
                  }
                  if (item.key === "result_calls") {
                    setLastCallType("result");
                  }
                  if (item.key === "other_calls") {
                    setLastCallType("other");
                  }
                  setMenuOpen(false);
                }}
              >
                <Text
                  style={[styles.menuItemText, activeMenu === item.key && styles.menuItemTextActive]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
          />
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
    paddingTop: Platform.OS === "android" ? (RNStatusBar.currentHeight || 14) : 14,
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
  menuButton: {
    backgroundColor: "#0f3057",
    borderRadius: 8,
    minWidth: 38,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonText: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "700",
    marginTop: -1,
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
  moduleTag: {
    color: "#6b7f95",
    marginTop: 2,
    fontSize: 12,
  },
  serverHint: {
    color: "#6b7f95",
    fontSize: 12,
    marginBottom: 8,
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
  otherActions: {
    flexDirection: "row",
    gap: 8,
  },
  empty: {
    color: "#4f6680",
    textAlign: "center",
    marginTop: 30,
  },
  reportCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d9dfeb",
  },
  reportTitle: {
    color: "#18273d",
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 4,
  },
  reportMeta: {
    color: "#4f6680",
    marginBottom: 10,
  },
  reportLine: {
    color: "#2f4761",
    marginBottom: 7,
  },
  reportBody: {
    color: "#2f4761",
    marginTop: 10,
    lineHeight: 20,
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
  menuOverlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  menuBackdrop: {
    flex: 1,
  },
  menuDrawer: {
    width: 260,
    backgroundColor: "#fff",
    paddingTop: 40,
    paddingHorizontal: 14,
    borderRightWidth: 1,
    borderRightColor: "#d9dfeb",
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f3057",
    marginBottom: 12,
  },
  menuItem: {
    borderWidth: 1,
    borderColor: "#d9dfeb",
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 9,
    backgroundColor: "#fff",
  },
  menuItemActive: {
    borderColor: "#0f5e9c",
    backgroundColor: "#e7f3ff",
  },
  menuItemText: {
    color: "#2f4761",
    fontWeight: "600",
  },
  menuItemTextActive: {
    color: "#0f5e9c",
  },
  doneButton: {
    backgroundColor: "#1f8b4c",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    opacity: 0.9,
  },
  notReceivedButton: {
    backgroundColor: "#d4a017",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
});

