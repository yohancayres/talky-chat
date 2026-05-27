import { useOAuth, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

// Necessário para fechar a aba do navegador ao voltar do OAuth.
WebBrowser.maybeCompleteAuthSession();

type Step = 'menu' | 'emailCode' | 'phoneCode';
type Mode = 'signIn' | 'signUp';

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();
  const { startOAuthFlow: startGoogle } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: startX } = useOAuth({ strategy: 'oauth_x' });

  const [step, setStep] = useState<Step>('menu');
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = signInLoaded && signUpLoaded;

  function fail(e: unknown, fallback: string) {
    const msg =
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
      (e instanceof Error ? e.message : fallback);
    Alert.alert('Entrar', msg);
  }

  // Conclui o login quando o status é 'complete'; senão mostra o status real
  // (ex.: 'missing_requirements' = a instância do Clerk exige mais que o código).
  async function finish(
    status: string | null,
    createdSessionId: string | null | undefined,
    setActive: (p: { session: string }) => Promise<unknown>,
    missing?: readonly string[],
  ) {
    if (status === 'complete' && createdSessionId) {
      await setActive({ session: createdSessionId });
      return;
    }
    const faltando = missing?.length ? `\n\nCampos exigidos: ${missing.join(', ')}.` : '';
    Alert.alert(
      'Entrar',
      `Não consegui concluir o login (status: ${status ?? 'desconhecido'}).${faltando}\n\n` +
        'No painel do Clerk, deixe o login por código SEM senha e sem campos ' +
        'obrigatórios (desative Password e o Name obrigatório).',
    );
  }

  // --- OAuth (Google / X) ---
  async function oauth(start: typeof startGoogle) {
    try {
      setBusy(true);
      const { createdSessionId, setActive } = await start({
        redirectUrl: Linking.createURL('/'),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (e) {
      fail(e, 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  // --- Email OTP (entra se existe, cria conta se não) ---
  async function startEmail() {
    if (!ready || !email.trim()) return;
    try {
      setBusy(true);
      try {
        await signIn!.create({ identifier: email.trim() });
        const factor = signIn!.supportedFirstFactors?.find(
          (f) => f.strategy === 'email_code',
        ) as { emailAddressId: string } | undefined;
        await signIn!.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: factor!.emailAddressId,
        });
        setMode('signIn');
      } catch {
        await signUp!.create({ emailAddress: email.trim() });
        await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
        setMode('signUp');
      }
      setCode('');
      setStep('emailCode');
    } catch (e) {
      fail(e, 'Não foi possível enviar o código.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    if (!ready || !code.trim()) return;
    try {
      setBusy(true);
      if (mode === 'signIn') {
        const res = await signIn!.attemptFirstFactor({ strategy: 'email_code', code: code.trim() });
        await finish(res.status, res.createdSessionId, setActiveSignIn!);
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
        await finish(res.status, res.createdSessionId, setActiveSignUp!, res.missingFields);
      }
    } catch (e) {
      fail(e, 'Código inválido.');
    } finally {
      setBusy(false);
    }
  }

  // --- Telefone OTP (SMS) ---
  async function startPhone() {
    if (!ready || !phone.trim()) return;
    const number = phone.trim();
    try {
      setBusy(true);
      try {
        await signIn!.create({ identifier: number });
        const factor = signIn!.supportedFirstFactors?.find(
          (f) => f.strategy === 'phone_code',
        ) as { phoneNumberId: string } | undefined;
        await signIn!.prepareFirstFactor({
          strategy: 'phone_code',
          phoneNumberId: factor!.phoneNumberId,
        });
        setMode('signIn');
      } catch {
        await signUp!.create({ phoneNumber: number });
        await signUp!.preparePhoneNumberVerification({ strategy: 'phone_code' });
        setMode('signUp');
      }
      setCode('');
      setStep('phoneCode');
    } catch (e) {
      fail(e, 'Não foi possível enviar o SMS.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhone() {
    if (!ready || !code.trim()) return;
    try {
      setBusy(true);
      if (mode === 'signIn') {
        const res = await signIn!.attemptFirstFactor({ strategy: 'phone_code', code: code.trim() });
        await finish(res.status, res.createdSessionId, setActiveSignIn!);
      } else {
        const res = await signUp!.attemptPhoneNumberVerification({ code: code.trim() });
        await finish(res.status, res.createdSessionId, setActiveSignUp!, res.missingFields);
      }
    } catch (e) {
      fail(e, 'Código inválido.');
    } finally {
      setBusy(false);
    }
  }

  const codeStep = step === 'emailCode' || step === 'phoneCode';

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.brand}>
        <Text style={styles.logo}>AmyChat</Text>
        <Text style={styles.tagline}>Entre para conversar com seus personagens.</Text>
      </View>

      {busy && <ActivityIndicator color={colors.accent} style={{ marginBottom: 16 }} />}

      {step === 'menu' && (
        <View style={styles.form}>
          <Pressable
            style={[styles.oauthBtn, busy && styles.disabled]}
            onPress={() => oauth(startGoogle)}
            disabled={busy}
          >
            <Text style={styles.oauthIcon}>G</Text>
            <Text style={styles.oauthText}>Continuar com Google</Text>
          </Pressable>

          <Pressable
            style={[styles.oauthBtn, busy && styles.disabled]}
            onPress={() => oauth(startX)}
            disabled={busy}
          >
            <Text style={styles.oauthIcon}>𝕏</Text>
            <Text style={styles.oauthText}>Continuar com X</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.line} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="seu@email.com"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            inputMode="email"
          />
          <Pressable
            style={[styles.primaryBtn, (busy || !email.trim()) && styles.disabled]}
            onPress={startEmail}
            disabled={busy || !email.trim()}
          >
            <Text style={styles.primaryText}>Enviar código por email</Text>
          </Pressable>

          <TextInput
            style={[styles.input, { marginTop: 14 }]}
            placeholder="+55 11 91234-5678"
            placeholderTextColor={colors.muted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            inputMode="tel"
          />
          <Pressable
            style={[styles.secondaryBtn, (busy || !phone.trim()) && styles.disabled]}
            onPress={startPhone}
            disabled={busy || !phone.trim()}
          >
            <Text style={styles.secondaryText}>Enviar SMS</Text>
          </Pressable>
        </View>
      )}

      {codeStep && (
        <View style={styles.form}>
          <Text style={styles.codeHint}>
            Digite o código que enviamos {step === 'emailCode' ? `para ${email}` : `por SMS`}.
          </Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="000000"
            placeholderTextColor={colors.muted}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={6}
            autoFocus
          />
          <Pressable
            style={[styles.primaryBtn, (busy || !code.trim()) && styles.disabled]}
            onPress={step === 'emailCode' ? verifyEmail : verifyPhone}
            disabled={busy || !code.trim()}
          >
            <Text style={styles.primaryText}>Confirmar</Text>
          </Pressable>
          <Pressable onPress={() => setStep('menu')} disabled={busy}>
            <Text style={styles.backLink}>‹ Voltar</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  brand: { alignItems: 'center', marginBottom: 36 },
  logo: { fontSize: 40, fontWeight: '800', color: colors.accent, letterSpacing: -1 },
  tagline: { fontSize: 15, color: colors.muted, marginTop: 8, textAlign: 'center' },
  form: { width: '100%' },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  oauthIcon: { fontSize: 18, fontWeight: '800', color: colors.text, marginRight: 10 },
  oauthText: { fontSize: 16, fontWeight: '600', color: colors.text },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: 12, color: colors.muted, fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    marginBottom: 10,
  },
  codeInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryText: { color: colors.accentDark, fontSize: 16, fontWeight: '700' },
  codeHint: { fontSize: 15, color: colors.text, marginBottom: 16, textAlign: 'center' },
  backLink: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 18 },
  disabled: { opacity: 0.5 },
});
